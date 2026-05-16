import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));

const file = args.file || "data/sample-kakao-export.txt";
const room = args.room || "희영이";
const externalSearch = args.external_search || "ask_first";
const replyMode = args.reply_mode || "both";
const output = args.output || "report.md";
const memoryFile = args.memory || "data/date-memory.json";
const runAt = args.now || new Date().toISOString();

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function readMemory(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {
      version: 1,
      updatedAt: null,
      personaSnapshots: [],
      searchHistory: [],
      courses: [],
      places: {}
    };
  }
}

function ensureMemoryShape(memory) {
  memory.version = memory.version || 1;
  memory.personaSnapshots = memory.personaSnapshots || [];
  memory.searchHistory = memory.searchHistory || [];
  memory.courses = memory.courses || [];
  memory.places = memory.places || {};
  return memory;
}

async function writeMemory(filePath, memory) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(memory, null, 2), "utf8");
}

function upsertPlace(memory, place, status = "candidate", seenAt = new Date().toISOString()) {
  if (!place?.name) return;
  const existing = memory.places[place.name] || {
    name: place.name,
    type: place.type,
    statuses: [],
    mentionCount: 0,
    lastSeenAt: null,
    sources: []
  };

  existing.type = existing.type || place.type;
  existing.statuses = unique([...existing.statuses, status]);
  existing.mentionCount = Math.max(existing.mentionCount, 1);
  existing.lastSeenAt = seenAt;
  existing.sources = unique([...(existing.sources || []), ...(place.sources || [])]);
  memory.places[place.name] = existing;
}

function rememberCourses(memory, signals, rankedAreas, reviewedCourses, messageDrafts, seenAt = new Date().toISOString()) {
  for (const course of reviewedCourses) {
    const placeNames = course.schedule.map((item) => item.replace(/^\d{1,2}:\d{2}\s*/, ""));
    const id = `${signals.dateDay}-${rankedAreas[0]?.area || signals.area}-${course.title}`.replace(/\s+/g, "-");
    const previous = memory.courses.find((item) => item.id === id);
    const record = {
      id,
      title: course.title,
      status: previous?.status || "suggested",
      dateDay: signals.dateDay,
      area: rankedAreas[0]?.area || signals.area,
      places: placeNames,
      approvalScore: course.approval.approvalScore,
      approvalDecision: course.approval.approvalDecision,
      messageDraft: messageDrafts[0]?.text || "",
      searchQueries: buildSearchQueries(signals),
      firstSeenAt: seenAt,
      lastUpdatedAt: seenAt,
      scoreHistory: upsertHistory(previous?.scoreHistory || [], {
        at: seenAt,
        approvalScore: course.approval.approvalScore,
        approvalDecision: course.approval.approvalDecision,
        reason: "current_export_analysis"
      }).slice(-10),
      notes: previous?.notes || []
    };

    if (previous) Object.assign(previous, record);
    else memory.courses.push(record);
  }

  memory.updatedAt = seenAt;
  memory.courses.sort((a, b) => b.approvalScore - a.approvalScore);
  return memory;
}

function rememberPersonaAndSearch(memory, persona, myPersona, queries, seenAt = new Date().toISOString()) {
  const personaSnapshot = {
    at: seenAt,
    partnerConfidence: persona.confidence,
    partnerSummary: persona.summary,
    partnerTone: persona.tone.traits,
    myConfidence: myPersona.confidence,
    mySummary: myPersona.summary,
    myTone: myPersona.tone.traits
  };
  const existingSnapshot = memory.personaSnapshots.find((item) =>
    item.at === personaSnapshot.at &&
    item.partnerSummary === personaSnapshot.partnerSummary &&
    item.mySummary === personaSnapshot.mySummary
  );
  if (!existingSnapshot) memory.personaSnapshots.push(personaSnapshot);
  memory.personaSnapshots = memory.personaSnapshots.slice(-10);

  for (const query of queries) {
    const existing = memory.searchHistory.find((item) => item.query === query);
    if (existing) {
      if (existing.lastUsedAt !== seenAt) existing.count += 1;
      existing.lastUsedAt = seenAt;
    } else {
      memory.searchHistory.push({
        query,
        count: 1,
        firstUsedAt: seenAt,
        lastUsedAt: seenAt
      });
    }
  }
  memory.searchHistory.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

function upsertHistory(history, entry) {
  const index = history.findIndex((item) => item.at === entry.at && item.reason === entry.reason);
  if (index >= 0) {
    history[index] = entry;
    return history;
  }
  return [...history, entry];
}

function courseToEvaluationShape(course) {
  return {
    title: course.title,
    schedule: course.places.map((place, index) => `${index === 0 ? "17:00" : index === 1 ? "19:00" : "20:00"} ${place}`),
    cost: "중간",
    travel: "낮음",
    verificationNeeded: ["memory_based_recheck_needed"]
  };
}

function rescoreExistingMemory(memory, signals, persona, seenAt = new Date().toISOString()) {
  const rescored = [];
  for (const course of memory.courses) {
    const evaluation = evaluateCourse(signals, persona, courseToEvaluationShape(course));
    const previousScore = course.approvalScore;
    course.approvalScore = evaluation.approvalScore;
    course.approvalDecision = evaluation.approvalDecision;
    course.lastRescoredAt = seenAt;
    course.scoreHistory = upsertHistory(course.scoreHistory || [], {
      at: seenAt,
      approvalScore: evaluation.approvalScore,
      approvalDecision: evaluation.approvalDecision,
      reason: "persona_update_rescore"
    }).slice(-10);
    rescored.push({
      title: course.title,
      previousScore,
      newScore: evaluation.approvalScore,
      decision: evaluation.approvalDecision
    });
  }
  memory.courses.sort((a, b) => b.approvalScore - a.approvalScore);
  return rescored;
}

function extract(text) {
  const conversationOnly = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("---------------"))
    .join("\n");
  const dateMatches = [...conversationOnly.matchAll(/(오늘|내일|모레|이번 주말|주말|월요일|화요일|수요일|목요일|금요일|토요일|일요일)/g)];
  const dateDay = dateMatches.at(-1)?.[1] || "unknown";
  const timeMatch = conversationOnly.match(/오후\s*(\d{1,2})\s*시|저녁|퇴근|끝나고/);
  const meetingTime = timeMatch?.[1] ? `${String(Number(timeMatch[1]) + 12).padStart(2, "0")}:00` : "unknown";
  const timeWindow = meetingTime !== "unknown" || hasAny(text, ["저녁", "퇴근", "끝나고"]) ? "evening" : "unknown";
  const area = ["성수", "홍대", "강남", "잠실", "연남", "한남", "서면", "부산"].find((item) => conversationOnly.includes(item)) || "unknown";
  const foods = unique(["파스타", "카페", "디저트", "초밥", "고기", "브런치"].filter((item) => conversationOnly.includes(item)));
  const constraints = unique([
    hasAny(conversationOnly, ["비싼", "부담", "저렴", "가성비"]) && "budget_sensitive",
    hasAny(conversationOnly, ["오래 걷", "역에서 가까", "가까운 데", "멀지"]) && "low_walking",
    hasAny(conversationOnly, ["비 오", "실내"]) && "weather_safe",
    hasAny(conversationOnly, ["조용", "자리 넓"]) && "quiet_comfortable"
  ]);
  const visitedAreas = unique([
    hasAny(conversationOnly, ["홍대는 너무 자주", "홍대 자주", "저번에 홍대", "홍대 또"]) && "홍대"
  ]);
  const wantedAreas = unique([
    hasAny(conversationOnly, ["한남은 아직 안 가", "한남 가보고", "한남 한번"]) && "한남",
    hasAny(conversationOnly, ["성수 오랜만", "성수 가고 싶"]) && "성수"
  ]);
  const dislikedAreas = unique([
    hasAny(conversationOnly, ["홍대는 너무 자주", "홍대는 사람 많", "홍대 별로"]) && "홍대"
  ]);
  const distanceHints = unique([
    hasAny(conversationOnly, ["역에서 가까", "가까운 데", "멀지"]) && "역 근처 선호",
    hasAny(conversationOnly, ["너무 먼 곳", "멀어", "회사 끝나고"]) && "먼 곳 회피"
  ]);

  return {
    dateDay,
    meetingTime,
    timeWindow,
    area,
    foods,
    constraints,
    locationMemory: {
      visitedAreas,
      wantedAreas,
      dislikedAreas,
      distanceHints,
      baseLocation: hasAny(conversationOnly, ["회사 끝나고"]) ? "회사/퇴근 동선 inferred" : "unknown"
    }
  };
}

function speakerLines(text) {
  const lines = text.split("\n");
  const mine = [];
  const partner = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("나 :")) mine.push(trimmed.replace(/^나\s*:\s*/, ""));
    if (trimmed.startsWith("희영이 :")) partner.push(trimmed.replace(/^희영이\s*:\s*/, ""));
  }

  return { mine, partner };
}

function toneProfile(lines, fallbackLabel) {
  const joined = lines.join("\n");
  const nonEmpty = lines.filter(Boolean);
  const averageLength = nonEmpty.length
    ? Math.round(nonEmpty.reduce((sum, line) => sum + line.length, 0) / nonEmpty.length)
    : 0;
  const endings = unique(nonEmpty.map((line) => {
    const match = line.match(/(어때|갈까|볼까|좋을듯|괜찮을듯|ㄱㄱ|하자|가자|좋아|괜찮아|ㅋㅋ|ㅎㅎ)[!?~.]*$/);
    return match?.[1];
  }));
  const addressTerms = unique(nonEmpty.flatMap((line) => {
    const found = [];
    if (line.includes("희영")) found.push("희영");
    if (line.includes("오빠")) found.push("오빠");
    if (line.includes("우리")) found.push("우리");
    return found;
  }));
  const traits = [];
  if (hasAny(joined, ["어때", "갈까", "할까"])) traits.push("상대 의견을 묻는 제안형");
  if (hasAny(joined, ["좋아", "괜찮", "응"])) traits.push("부드러운 동의 표현 사용");
  if (hasAny(joined, ["좀", "너무", "가볍게", "무리"])) traits.push("부담을 낮추는 표현 선호");
  if (hasAny(joined, ["ㅋㅋ", "ㅎㅎ", "ㄱㄱ", "듯"])) traits.push("캐주얼하고 짧은 톤");
  if (hasAny(joined, ["생각해봤", "잡아볼", "코스"])) traits.push("계획을 정리해서 제안하는 톤");
  if (averageLength > 0 && averageLength <= 18) traits.push("짧은 문장 선호");
  if (averageLength >= 35) traits.push("설명형 문장 선호");

  return {
    label: fallbackLabel,
    confidence: lines.length >= 4 ? "medium_high" : lines.length >= 2 ? "medium" : "low",
    traits: unique(traits),
    sampleCount: lines.length,
    averageLength,
    endings,
    addressTerms,
    usesChoseong: /[ㄱ-ㅎ]/.test(joined),
    usesLaughter: /ㅋㅋ|ㅎㅎ/.test(joined)
  };
}

function buildPersona(signals, lines) {
  const traits = [];
  if (signals.constraints.includes("quiet_comfortable")) traits.push("조용하고 좌석이 편한 장소를 선호할 가능성이 높음");
  if (signals.constraints.includes("low_walking")) traits.push("긴 도보 이동보다 역 근처의 짧은 동선을 선호함");
  if (signals.constraints.includes("budget_sensitive")) traits.push("가격 부담이 큰 장소는 피하고 중저가 선택지를 선호함");
  if (signals.timeWindow === "evening") traits.push("오후 늦게 또는 저녁 중심의 데이트가 현재 일정에 맞음");
  if (signals.foods.length) traits.push(`${signals.foods.join(", ")} 관련 장소에 반응이 좋음`);

  return {
    label: "상대 데이트 취향 페르소나",
    confidence: traits.length >= 4 ? "medium_high" : "medium",
    summary: traits.length
      ? traits.join("; ")
      : "대화에서 명확한 데이트 취향이 부족해 기본적인 저녁 식사와 카페 중심 코스를 가정함",
    tone: toneProfile(lines.partner, "상대 카톡 톤 페르소나"),
    guardrail: "이 페르소나는 데이트 코스와 메시지 작성용 가설이며 성격, 감정, 관계 상태를 단정하지 않습니다."
  };
}

function buildMyPersona(lines) {
  const tone = toneProfile(lines.mine, "내 카톡 톤 페르소나");
  const joined = lines.mine.join("\n");
  const habits = [];

  if (hasAny(joined, ["어디 갈까", "갈까"])) habits.push("먼저 후보를 열어두고 묻는 편");
  if (hasAny(joined, ["저녁 먹고", "카페"])) habits.push("식사와 카페처럼 간단한 흐름으로 제안");
  if (hasAny(joined, ["비 오면", "실내"])) habits.push("상황 변수를 챙기는 편");

  return {
    label: "내 제안 메시지 페르소나",
    confidence: tone.confidence,
    summary: habits.length
      ? habits.join("; ")
      : "상대가 고르기 쉽게 짧고 부드럽게 제안하는 톤을 기본값으로 사용",
    tone,
    guardrail: "내 페르소나는 메시지 톤 조정용이며 실제 성격을 단정하지 않습니다."
  };
}

function buildSearchQueries(signals) {
  const rankedAreas = rankAreas(signals);
  const area = rankedAreas[0]?.area || (signals.area === "unknown" ? "서울" : signals.area);
  const food = signals.foods.includes("파스타") ? "파스타" : "맛집";
  const time = signals.timeWindow === "evening" ? "저녁" : "데이트";
  const quiet = signals.constraints.includes("quiet_comfortable") ? "조용한 카페" : "카페";
  const indoor = signals.constraints.includes("weather_safe") ? "비오는 날 실내 데이트" : "데이트 코스";
  return unique([
    `${area} ${time} ${food} ${quiet} 데이트`,
    `${area} ${indoor} 블로그 리뷰`,
    `${area} 역 근처 ${food} 예약 데이트`
  ]);
}

function researchPlaces(signals, rankedAreas, externalSearchMode, memory) {
  const area = rankedAreas[0]?.area || signals.area;
  if (area !== "성수") {
    return {
      mode: externalSearchMode === "allowed" ? "live_search_required" : "needs_search_approval",
      restaurants: [],
      cafes: [],
      activities: [],
      note: "현재 번들 리서치 후보는 성수 샘플만 포함합니다. 다른 지역은 외부 검색 승인 후 구체 장소를 조사해야 합니다."
    };
  }

  const mode = externalSearchMode === "allowed" ? "bundled_reference_plus_live_verification_needed" : "bundled_reference_pending_live_verification";
  const research = {
    mode,
    restaurants: [
      {
        name: "투파인드피터 서울성수점",
        type: "restaurant",
        fitTags: ["파스타", "이탈리안", "데이트", "조용한 분위기", "성수"],
        why: "파스타 선호, 조용한 분위기, 중저가/부담 낮은 데이트 조건에 맞는 후보입니다.",
        oneLineReview: "번들 리서치 기준: 테이블 간격과 조용한 분위기 언급이 있어 편한 저녁 데이트 후보로 적합합니다.",
        sources: [
          "https://www.diningcode.com/list.dc?query=%EC%84%B1%EC%88%98%EC%97%AD++%EC%A1%B0%EC%9A%A9%ED%95%9C+%EC%86%8C%EA%B0%9C%ED%8C%85",
          "https://fd.jhsunjane.com/52"
        ],
        sourceAnalysis: {
          naverMap: "needs_live_verification: 영업시간, 현재 평점, 예약/웨이팅, 거리 정보를 네이버 지도에서 확인해야 합니다.",
          naverBlog: "bundled_reference: 성수역 근처 가성비 이탈리안/데이트 후보로 소개된 블로그 맥락을 사용했습니다.",
          instagram: "needs_live_verification: 공개 게시물/위치 태그에서 최근 분위기, 사진 밀도, 웨이팅 언급을 확인해야 합니다."
        },
        verificationNeeded: ["현재 영업시간", "예약 가능 여부", "웨이팅", "최신 메뉴 가격"]
      },
      {
        name: "연남토마 성수점",
        type: "restaurant",
        fitTags: ["파스타", "서울숲", "성수", "역 접근성"],
        why: "성수/서울숲 동선에서 파스타와 식사 메뉴를 함께 고려할 수 있는 후보입니다.",
        oneLineReview: "번들 리서치 기준: 역 접근성과 파스타 메뉴가 확인되어 성수 저녁 식사 후보로 쓸 수 있습니다.",
        sources: ["https://www.awesomble.com/ko/Aosdin/kr-seoul-seongsu-yeonnam-toma/"],
        sourceAnalysis: {
          naverMap: "needs_live_verification: 지도 기준 도보 거리, 현재 영업시간, 메뉴/리뷰 최신성을 확인해야 합니다.",
          naverBlog: "provided_reference: 장소 소개 페이지의 접근성/메뉴 정보를 사용했습니다.",
          instagram: "needs_live_verification: 성수/서울숲 위치 태그의 최근 사진과 혼잡도를 확인해야 합니다."
        },
        verificationNeeded: ["현재 영업시간", "웨이팅", "좌석 분위기", "메뉴 변동"]
      }
    ],
    cafes: [
      {
        name: "성수 비아트",
        type: "cafe",
        fitTags: ["조용한 카페", "넓은 좌석", "성수역 근처", "디저트"],
        why: "조용하고 자리 넓은 카페를 원한다는 대화 조건에 가장 직접적으로 맞는 후보입니다.",
        oneLineReview: "번들 리서치 기준: 넓고 조용한 카페로 소개되어 대화 중심의 저녁 카페 코스에 어울립니다.",
        sources: ["https://euphoria25.tistory.com/137"],
        sourceAnalysis: {
          naverMap: "needs_live_verification: 영업시간, 좌석/혼잡 리뷰, 성수역 도보 거리를 확인해야 합니다.",
          naverBlog: "bundled_reference: 넓고 조용한 성수 카페로 소개된 블로그 맥락을 사용했습니다.",
          instagram: "needs_live_verification: 공개 위치 태그에서 좌석/디저트/분위기 사진을 확인해야 합니다."
        },
        verificationNeeded: ["현재 영업시간", "좌석 여유", "실제 소음 수준"]
      }
    ],
    activities: [
      {
        name: "히어로보드게임카페 성수점",
        type: "indoor_activity",
        fitTags: ["비오는 날", "실내", "성수역 근처", "긴 도보 회피"],
        why: "비가 오거나 야외 산책이 부담될 때 짧은 동선으로 대체할 수 있는 실내 활동 후보입니다.",
        oneLineReview: "번들 리서치 기준: 성수역 근처 실내 활동으로 날씨 영향을 줄이는 대안입니다.",
        sources: ["https://ilovefood.tistory.com/v/174"],
        sourceAnalysis: {
          naverMap: "needs_live_verification: 현재 운영시간, 가격, 성수역 도보 거리, 방문자 리뷰를 확인해야 합니다.",
          naverBlog: "bundled_reference: 성수역 근처 실내 보드게임 활동으로 소개된 블로그 맥락을 사용했습니다.",
          instagram: "needs_live_verification: 공개 태그에서 내부 분위기와 최근 방문 반응을 확인해야 합니다."
        },
        verificationNeeded: ["현재 영업시간", "가격", "혼잡도"]
      }
    ],
    note: "장소명은 번들 reference 기반 샘플입니다. 실제 제출/사용 전에는 외부 검색 또는 지도 API로 최신 정보를 확인해야 합니다."
  };

  for (const place of [...research.restaurants, ...research.cafes, ...research.activities]) {
    const remembered = memory.places[place.name];
    place.memoryStatus = remembered ? remembered.statuses.join(", ") : "new_candidate";
    place.memoryMentionCount = remembered?.mentionCount || 0;
  }

  return research;
}

function rankAreas(signals) {
  const candidates = unique([
    signals.area !== "unknown" && signals.area,
    ...signals.locationMemory.wantedAreas,
    ...signals.locationMemory.visitedAreas,
    "연남"
  ]);

  return candidates
    .map((area) => {
      let score = 50;
      const reasons = [];
      let visitStatus = "unknown";

      if (area === signals.area) {
        score += 25;
        reasons.push("대화에서 현재 후보 지역으로 언급됨");
      }
      if (signals.locationMemory.wantedAreas.includes(area)) {
        score += 20;
        visitStatus = "wanted_or_unvisited";
        reasons.push("가보고 싶거나 아직 안 가본 곳으로 언급됨");
      }
      if (signals.locationMemory.visitedAreas.includes(area)) {
        score -= 10;
        visitStatus = "visited_or_repeated";
        reasons.push("이미 자주 간 곳으로 언급됨");
      }
      if (signals.locationMemory.dislikedAreas.includes(area)) {
        score -= 25;
        reasons.push("혼잡/반복 방문 등 불호 신호가 있음");
      }
      if (signals.locationMemory.distanceHints.length > 0 && area === signals.area) {
        score += 5;
        reasons.push("거리 힌트는 있으나 정확한 기준 위치가 없어 대화 근거로만 정렬");
      }

      return {
        area,
        score,
        visitStatus,
        distanceRank: signals.locationMemory.baseLocation === "unknown" ? "unknown" : "inferred",
        reasons
      };
    })
    .sort((a, b) => b.score - a.score);
}

function buildCourses(signals, persona, placeResearch) {
  const rankedAreas = rankAreas(signals);
  const area = rankedAreas[0]?.area || (signals.area === "unknown" ? "후보 지역" : signals.area);
  const start = signals.meetingTime === "unknown" ? "18:00" : signals.meetingTime;
  const primaryRestaurant = placeResearch.restaurants[0];
  const secondaryRestaurant = placeResearch.restaurants[1] || placeResearch.restaurants[0];
  const primaryCafe = placeResearch.cafes[0];
  const primaryActivity = placeResearch.activities[0];
  const food = primaryRestaurant?.name || (signals.foods.includes("파스타") ? "파스타 식당 후보 조사 필요" : "저녁 식사 후보 조사 필요");
  const cafe = primaryCafe?.name || (signals.constraints.includes("quiet_comfortable") ? "조용한 카페 후보 조사 필요" : "카페 후보 조사 필요");
  const activity = primaryActivity?.name || (signals.constraints.includes("weather_safe") ? "실내 활동 후보 조사 필요" : "짧은 산책 또는 소품샵 후보 조사 필요");

  return [
    {
      title: `${area} 저녁 식사 + 카페 안정 코스`,
      schedule: [`${start} ${food}`, "19:00 " + cafe, "20:00 " + activity],
      cost: signals.constraints.includes("budget_sensitive") ? "중저가" : "중간",
      travel: signals.constraints.includes("low_walking") ? "낮음" : "중간 이하",
      personaFit: persona.summary,
      placeReason: [
        primaryRestaurant?.why,
        primaryCafe?.why,
        primaryActivity?.why
      ].filter(Boolean),
      reviewOneLiner: [
        primaryRestaurant?.oneLineReview,
        primaryCafe?.oneLineReview,
        primaryActivity?.oneLineReview
      ].filter(Boolean).join(" / ") || "장소 조사 후 리뷰 요약 필요",
      sources: unique([
        ...(primaryRestaurant?.sources || []),
        ...(primaryCafe?.sources || []),
        ...(primaryActivity?.sources || [])
      ]),
      sourceAnalysis: [
        primaryRestaurant?.sourceAnalysis,
        primaryCafe?.sourceAnalysis,
        primaryActivity?.sourceAnalysis
      ].filter(Boolean),
      areaRank: rankedAreas[0],
      verificationNeeded: unique([
        ...(primaryRestaurant?.verificationNeeded || []),
        ...(primaryCafe?.verificationNeeded || []),
        ...(primaryActivity?.verificationNeeded || [])
      ])
    },
    {
      title: `${area} 비 오는 날 실내 중심 코스`,
      schedule: [`${start} ${secondaryRestaurant?.name || food}`, "19:20 " + activity, "21:00 " + cafe],
      cost: "중간",
      travel: "낮음",
      personaFit: "날씨와 도보 부담을 줄이는 조건을 강하게 반영",
      placeReason: [
        secondaryRestaurant?.why,
        primaryActivity?.why,
        primaryCafe?.why
      ].filter(Boolean),
      reviewOneLiner: [
        secondaryRestaurant?.oneLineReview,
        primaryActivity?.oneLineReview,
        primaryCafe?.oneLineReview
      ].filter(Boolean).join(" / ") || "장소 조사 후 리뷰 요약 필요",
      sources: unique([
        ...(secondaryRestaurant?.sources || []),
        ...(primaryActivity?.sources || []),
        ...(primaryCafe?.sources || [])
      ]),
      sourceAnalysis: [
        secondaryRestaurant?.sourceAnalysis,
        primaryActivity?.sourceAnalysis,
        primaryCafe?.sourceAnalysis
      ].filter(Boolean),
      areaRank: rankedAreas[0],
      verificationNeeded: unique([
        ...(secondaryRestaurant?.verificationNeeded || []),
        ...(primaryActivity?.verificationNeeded || []),
        ...(primaryCafe?.verificationNeeded || [])
      ])
    }
  ];
}

function buildMessageDrafts(reviewedCourses, signals, rankedAreas, partnerPersona, myPersona) {
  const best = reviewedCourses[0];
  const second = reviewedCourses[1];
  const area = rankedAreas[0]?.area || signals.area || "어딘가";
  const date = signals.dateDay === "unknown" ? "다음 데이트" : signals.dateDay;
  const time = signals.meetingTime === "unknown" ? "시간 맞춰서" : `${signals.meetingTime}쯤`;

  const partnerPref = partnerPersona.summary.includes("긴 도보") ? "많이 안 걷고" : "무리 없고";
  const casual = myPersona.tone.traits.includes("캐주얼하고 짧은 톤") || myPersona.tone.usesChoseong;
  const short = myPersona.tone.traits.includes("짧은 문장 선호");
  const laugh = myPersona.tone.usesLaughter ? " ㅋㅋ" : "";
  const goPhrase = myPersona.tone.endings.includes("ㄱㄱ") ? "ㄱㄱ?" : "어때?";
  const seemsGood = myPersona.tone.endings.includes("좋을듯") || myPersona.tone.endings.includes("괜찮을듯")
    ? "괜찮을듯"
    : "괜찮을 것 같아";

  const shortDraft = best
    ? casual
      ? `${date} ${time} ${area} ${goPhrase}${laugh}\n${best.schedule.join(" → ")}\n이런 느낌이면 ${partnerPref} ${seemsGood}`
      : `${date} ${time} ${area} 어때? ${best.schedule.join(" → ")} 이런 느낌이면 ${partnerPref} 괜찮을 것 같아.`
    : `${date}에 ${area} 쪽으로 가볍게 밥 먹고 카페 가는 거 어때?`;

  const softDraft = best
    ? short
      ? `${date} ${area} 코스 하나 생각해봄${laugh}\n${best.schedule.join(" → ")}\n조용하고 동선 무리 없을듯. 어때?`
      : `${date}에 ${area} 가면 좋을 것 같아서 코스 하나 생각해봤어. ${best.schedule.join(" → ")} 정도면 조용하고 동선도 무리 없을 것 같은데 어때?`
    : `${date}에 너무 빡세지 않게 밥이랑 카페 위주로 잡아볼까?`;

  const optionDraft = second
    ? casual
      ? `${date} 후보 두 개 생각해봄${laugh}\n1) ${best.title}: ${best.schedule.join(" → ")}\n2) ${second.title}: ${second.schedule.join(" → ")}\n뭐가 더 좋아?`
      : `${date} 후보 두 개 생각해봤어.\n1) ${best.title}: ${best.schedule.join(" → ")}\n2) ${second.title}: ${second.schedule.join(" → ")}\n너는 어느 쪽이 더 좋아?`
    : `${date}에는 ${area}에서 밥 먹고 카페 가는 편한 코스가 괜찮아 보여.`;

  return [
    {
      style: "short_casual",
      useCase: "카톡에서 바로 가볍게 제안",
      text: shortDraft
    },
    {
      style: "warm_explained",
      useCase: "왜 이 코스가 좋은지 살짝 설명",
      text: softDraft
    },
    {
      style: "two_options",
      useCase: "상대가 고를 수 있게 후보 2개 제안",
      text: optionDraft
    }
  ];
}

function buildFastReplyCard(reviewedCourses, messageDrafts) {
  const top = reviewedCourses[0];
  const alternative = reviewedCourses[1];
  const bestMessage = messageDrafts.find((draft) => draft.style === "short_casual")?.text || messageDrafts[0]?.text || "";
  const shorterMessage = bestMessage
    .replace(/ 이런 느낌이면.*$/, " 이렇게 가볍게 가볼까?")
    .replace(/ → /g, " > ");

  return {
    mode: "fast_reply",
    goal: "사용자가 10초 안에 카톡에 붙여넣어 데이트 선택을 시작하게 함",
    topRecommendation: top ? {
      title: top.title,
      approvalScore: top.approval.approvalScore,
      schedule: top.schedule
    } : null,
    alternative: alternative ? {
      title: alternative.title,
      approvalScore: alternative.approval.approvalScore,
      schedule: alternative.schedule
    } : null,
    bestPasteReadyMessage: bestMessage,
    shorterMessage,
    nextUserAction: "메시지를 복사해서 카카오톡 입력창에 붙여넣고, 상대 반응이 오면 다음 export로 다시 갱신"
  };
}

function evaluateCourse(signals, persona, course) {
  const matched = [];
  const concerns = [];
  const adjustments = [];
  let score = 50;

  if (signals.timeWindow === "evening" && course.schedule.join(" ").match(/18:00|19:|20:|21:|오후|저녁/)) {
    score += 15;
    matched.push("저녁/오후 늦은 시간대에 맞음");
  } else if (signals.timeWindow !== "unknown") {
    concerns.push("추출된 시간대와 일정이 완전히 맞는지 확인 필요");
  }

  if (signals.constraints.includes("low_walking") && course.travel === "낮음") {
    score += 15;
    matched.push("도보 부담이 낮음");
  } else if (signals.constraints.includes("low_walking")) {
    score -= 10;
    concerns.push("긴 이동을 싫어하는 조건에 비해 이동 부담이 있을 수 있음");
    adjustments.push("역 근처 장소 2개 이하로 줄이기");
  }

  if (signals.constraints.includes("budget_sensitive") && ["중저가", "중간"].includes(course.cost)) {
    score += 10;
    matched.push("가격 부담을 낮춘 비용대");
  } else if (signals.constraints.includes("budget_sensitive")) {
    score -= 15;
    concerns.push("예산 부담 조건과 맞지 않을 수 있음");
    adjustments.push("1인 3만원 이하 식당 후보로 대체");
  }

  if (signals.constraints.includes("quiet_comfortable") && course.schedule.join(" ").includes("카페")) {
    score += 10;
    matched.push("조용한 카페 선호를 반영");
  }

  if (signals.constraints.includes("weather_safe") && course.title.includes("실내")) {
    score += 10;
    matched.push("비/날씨 변수에 안전함");
  }

  if (signals.foods.includes("파스타") && course.schedule.join(" ").includes("파스타")) {
    score += 10;
    matched.push("파스타 선호 반영");
  }

  if (course.verificationNeeded.length > 3) {
    score -= 5;
    concerns.push("검증해야 할 항목이 많음");
  }

  score = Math.max(0, Math.min(100, score));
  const approvalDecision = score >= 85 ? "approve" : score >= 65 ? "soft_approve" : "disapprove";

  if (approvalDecision !== "approve" && adjustments.length === 0) {
    adjustments.push("장소 확정 후 영업시간, 웨이팅, 이동 시간을 줄이는 방향으로 조정");
  }

  return {
    approvalDecision,
    approvalScore: score,
    matchedPreferences: matched,
    concerns,
    recommendedAdjustments: adjustments,
    personaGuardrail: persona.guardrail
  };
}

const raw = await readFile(file, "utf8");
const memory = ensureMemoryShape(await readMemory(memoryFile));
const safeText = raw.replace(/(인증번호|비밀번호|password|api[_-]?key|계좌번호|주민등록).*/gi, "[REDACTED]");
const signals = extract(safeText);
const lines = speakerLines(safeText);
const persona = buildPersona(signals, lines);
const myPersona = buildMyPersona(lines);
const rankedAreas = rankAreas(signals);
const placeResearch = researchPlaces(signals, rankedAreas, externalSearch, memory);
const queries = buildSearchQueries(signals);
const rescoredMemory = rescoreExistingMemory(memory, signals, persona, runAt);
const courses = buildCourses(signals, persona, placeResearch);
const reviewedCourses = courses
  .map((course) => ({ ...course, approval: evaluateCourse(signals, persona, course) }))
  .sort((a, b) => b.approval.approvalScore - a.approval.approvalScore);
const messageDrafts = buildMessageDrafts(reviewedCourses, signals, rankedAreas, persona, myPersona);
const fastReplyCard = buildFastReplyCard(reviewedCourses, messageDrafts);
rememberPersonaAndSearch(memory, persona, myPersona, queries, runAt);
for (const place of [...placeResearch.restaurants, ...placeResearch.cafes, ...placeResearch.activities]) {
  upsertPlace(memory, place, "candidate", runAt);
}
rememberCourses(memory, signals, rankedAreas, reviewedCourses, messageDrafts, runAt);
await writeMemory(memoryFile, memory);
const approvalRate = Math.round(
  reviewedCourses.reduce((sum, course) => sum + course.approval.approvalScore, 0) / reviewedCourses.length
);

const report = `# 카카오톡 데이트 코스 분석 리포트

## Input Scope
- chat_export_file: ${file}
- approved_contact_or_room: ${room}
- external_search: ${externalSearch}
- reply_mode: ${replyMode}
- memory_file: ${memoryFile}
- raw chat storage: no

## Extracted Date Signals
- 날짜: ${signals.dateDay}
- 만나는 시간: ${signals.meetingTime}
- 시간대: ${signals.timeWindow}
- 지역: ${signals.area}
- 음식/장소 선호: ${signals.foods.join(", ") || "unknown"}
- 제약: ${signals.constraints.join(", ") || "unknown"}

## Dating Personas
### Partner Persona
- confidence: ${persona.confidence}
- summary: ${persona.summary}
- message_tone: ${persona.tone.traits.join(", ") || "unknown"}
- guardrail: ${persona.guardrail}

### My Message Persona
- confidence: ${myPersona.confidence}
- summary: ${myPersona.summary}
- message_tone: ${myPersona.tone.traits.join(", ") || "unknown"}
- guardrail: ${myPersona.guardrail}

## Missing Context and Assumptions
- 실제 장소명은 웹/지도 검색 후 확정 필요
- 예산은 대화상 부담 표현을 근거로 중저가 우선
- 정확한 이동 시간은 장소 확정 후 계산 필요

## Location Memory and Area Ranking
${rankedAreas.map((item, index) => `${index + 1}. ${item.area}
   - score: ${item.score}
   - visit_status: ${item.visitStatus}
   - distance_rank: ${item.distanceRank}
   - reasons: ${item.reasons.join(", ") || "대화 근거 부족"}
`).join("\n")}

## Place Research Candidates
- mode: ${placeResearch.mode}
- note: ${placeResearch.note}

### Restaurants
${placeResearch.restaurants.map((place) => `- ${place.name}
  - why: ${place.why}
  - one_line_review: ${place.oneLineReview}
  - sources: ${place.sources.join(", ")}
  - naver_map: ${place.sourceAnalysis.naverMap}
  - naver_blog: ${place.sourceAnalysis.naverBlog}
  - instagram: ${place.sourceAnalysis.instagram}
  - memory_status: ${place.memoryStatus}
  - memory_mention_count: ${place.memoryMentionCount}
  - verification_needed: ${place.verificationNeeded.join(", ")}
`).join("") || "- 후보 조사 필요\n"}

### Cafes
${placeResearch.cafes.map((place) => `- ${place.name}
  - why: ${place.why}
  - one_line_review: ${place.oneLineReview}
  - sources: ${place.sources.join(", ")}
  - naver_map: ${place.sourceAnalysis.naverMap}
  - naver_blog: ${place.sourceAnalysis.naverBlog}
  - instagram: ${place.sourceAnalysis.instagram}
  - memory_status: ${place.memoryStatus}
  - memory_mention_count: ${place.memoryMentionCount}
  - verification_needed: ${place.verificationNeeded.join(", ")}
`).join("") || "- 후보 조사 필요\n"}

### Activities
${placeResearch.activities.map((place) => `- ${place.name}
  - why: ${place.why}
  - one_line_review: ${place.oneLineReview}
  - sources: ${place.sources.join(", ")}
  - naver_map: ${place.sourceAnalysis.naverMap}
  - naver_blog: ${place.sourceAnalysis.naverBlog}
  - instagram: ${place.sourceAnalysis.instagram}
  - memory_status: ${place.memoryStatus}
  - memory_mention_count: ${place.memoryMentionCount}
  - verification_needed: ${place.verificationNeeded.join(", ")}
`).join("") || "- 후보 조사 필요\n"}

## Search Queries ${externalSearch === "allowed" ? "Used" : "To Approve"}
${queries.map((query) => `- ${query}`).join("\n")}

## Search Tracking
- unique_queries_in_db: ${memory.searchHistory.length}
- recent_queries:
${memory.searchHistory.slice(0, 5).map((item) => `  - ${item.query} (count ${item.count}, last ${item.lastUsedAt})`).join("\n")}

## Recommended Date Courses
${reviewedCourses.map((course, index) => `### ${index + 1}. ${course.title}
- 일정: ${course.schedule.join(" → ")}
- 비용대: ${course.cost}
- 이동 부담: ${course.travel}
- 지역/방문 상태: ${course.areaRank.area} / ${course.areaRank.visitStatus}
- 거리 정렬: ${course.areaRank.distanceRank}
- 페르소나 적합성: ${course.personaFit}
- 장소 선정 이유:
${course.placeReason.map((reason) => `  - ${reason}`).join("\n")}
- 리뷰/블로그 한 줄: ${course.reviewOneLiner}
- 출처: ${course.sources.join(", ") || "검색 필요"}
- 네이버 지도/블로그/인스타 분석:
${course.sourceAnalysis.map((source, sourceIndex) => `  - stop ${sourceIndex + 1}
    - naver_map: ${source.naverMap}
    - naver_blog: ${source.naverBlog}
    - instagram: ${source.instagram}`).join("\n")}
- 확인 필요: ${course.verificationNeeded.join(", ")}
`).join("\n")}

## Persona Approval Review
${reviewedCourses.map((course) => `### ${course.title}
- decision: ${course.approval.approvalDecision}
- score: ${course.approval.approvalScore}/100
- matched: ${course.approval.matchedPreferences.join(", ") || "none"}
- concerns: ${course.approval.concerns.join(", ") || "none"}
- adjustments: ${course.approval.recommendedAdjustments.join(", ") || "none"}
`).join("\n")}

## Approval Rate
- overall_approval_rate: ${approvalRate}/100

## KakaoTalk Message Drafts
${messageDrafts.map((draft) => `### ${draft.style}
- use_case: ${draft.useCase}
- draft:
${draft.text.split("\n").map((line) => `  ${line}`).join("\n")}
`).join("\n")}

## Fast Reply Card
- top_recommendation: ${fastReplyCard.topRecommendation?.title || "none"}
- top_approval_score: ${fastReplyCard.topRecommendation?.approvalScore ?? "unknown"}
- alternative: ${fastReplyCard.alternative?.title || "none"}
- best_paste_ready_message:
  ${fastReplyCard.bestPasteReadyMessage.split("\n").map((line) => line).join("\n  ")}
- shorter_message:
  ${fastReplyCard.shorterMessage.split("\n").map((line) => line).join("\n  ")}
- next_user_action: ${fastReplyCard.nextUserAction}

## Date Course Memory
- memory_file: ${memoryFile}
- remembered_courses: ${memory.courses.length}
- remembered_places: ${Object.keys(memory.places).length}
- persona_snapshots: ${memory.personaSnapshots.length}
- latest_course_statuses:
${memory.courses.slice(0, 5).map((course) => `  - ${course.title}: ${course.status}, score ${course.approvalScore}, places ${course.places.join(" / ")}`).join("\n")}
- rescored_existing_courses:
${rescoredMemory.length ? rescoredMemory.slice(0, 5).map((course) => `  - ${course.title}: ${course.previousScore} -> ${course.newScore} (${course.decision})`).join("\n") : "  - none"}

## Verification Needed
- 외부 검색 허용 후 실제 블로그/지도/공식 페이지로 장소 후보 검증
- 영업시간, 가격, 예약 가능 여부 확인
- 블로그 협찬/광고 가능성 표시

## JSON Summary
\`\`\`json
${JSON.stringify({ signals, rankedAreas, placeResearch, partnerPersona: persona, myPersona, approvalRate, messageDrafts, fastReplyCard, rescoredMemory, dateMemory: memory, courses: reviewedCourses }, null, 2)}
\`\`\`
`;

await writeFile(output, report, "utf8");
console.log(`Wrote ${path.resolve(output)}`);
