import http from "node:http";
import { execFile } from "node:child_process";
import { readFile, stat, appendFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataFile = path.join(__dirname, "data", "approved-room.txt");
const ocrTool = path.join(__dirname, "tools", "kakao_ocr.swift");
const port = Number(process.env.PORT || 4173);
const liveOcr = process.env.KAKAO_LIVE_OCR === "1";

const consent = {
  userApproved: true,
  approvedSource: liveOcr ? "pc_visible_text_ocr" : "pc_visible_text_mock",
  approvedRoom: "성수 데이트방",
  approvedPurpose: "date_course_planning",
  retentionMode: "summary_only"
};

let cachedState = null;
let cachedMtimeMs = 0;
let latestOcr = {
  enabled: liveOcr,
  checkedAt: null,
  ok: false,
  lineCount: 0,
  error: liveOcr ? null : "live_ocr_disabled"
};

const demoMessages = [
  "B: 아 근데 토요일 비 온대. 실내 위주가 좋겠다.",
  "A: 영화도 괜찮고, 너무 늦게 끝나지만 않으면 좋아.",
  "B: 카페는 조용하고 자리 넓은 곳이면 좋겠어.",
  "A: 저녁은 1인 3만원 넘으면 좀 부담될 듯.",
  "B: 지하철역에서 너무 멀지 않은 데로 하자."
];

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function extractTiming(text) {
  const timeMatch = text.match(/(?:오전|아침)\s*(\d{1,2})\s*시|(?:오후|저녁)\s*(\d{1,2})\s*시|(\d{1,2})\s*시\s*(?:쯤|정도)?/);
  let meetingTime = "unknown";
  let timeWindow = "unknown";

  if (timeMatch) {
    const morningHour = timeMatch[1] ? Number(timeMatch[1]) : null;
    const afternoonHour = timeMatch[2] ? Number(timeMatch[2]) : null;
    const bareHour = timeMatch[3] ? Number(timeMatch[3]) : null;
    let hour = morningHour ?? afternoonHour ?? bareHour;

    if (afternoonHour && hour < 12) hour += 12;
    if (!afternoonHour && !morningHour && hour >= 5 && hour <= 10 && includesAny(text, ["저녁", "퇴근", "밤"])) {
      hour += 12;
    }

    meetingTime = `${String(hour).padStart(2, "0")}:00`;
    if (hour < 11) timeWindow = "morning";
    else if (hour < 14) timeWindow = "lunch";
    else if (hour < 17) timeWindow = "afternoon";
    else if (hour < 22) timeWindow = "evening";
    else timeWindow = "late_night";
  } else if (includesAny(text, ["퇴근", "저녁", "밤", "야간"])) {
    timeWindow = "evening";
  } else if (includesAny(text, ["오후", "낮"])) {
    timeWindow = "afternoon";
  } else if (includesAny(text, ["점심", "브런치"])) {
    timeWindow = "lunch";
  }

  const dayMatch = text.match(/(오늘|내일|모레|이번\s*주말|주말|월요일|화요일|수요일|목요일|금요일|토요일|일요일)/);
  const durationHint = includesAny(text, ["잠깐", "가볍게", "피곤", "퇴근", "오래 걷"]) ? "short_or_after_work" : "unknown";

  return {
    dateDay: dayMatch ? dayMatch[1].replace(/\s/g, "") : "unknown",
    meetingTime,
    timeWindow,
    durationHint
  };
}

function extractSignals(text) {
  const timing = extractTiming(text);
  const area = ["성수", "홍대", "강남", "잠실", "건대", "이태원", "연남", "한남", "부산", "서면"].find((item) => text.includes(item)) || "unknown";
  const foods = [
    ["파스타", "파스타"],
    ["피자", "피자"],
    ["초밥", "초밥"],
    ["고기", "고기"],
    ["브런치", "브런치"],
    ["카페", "카페"],
    ["디저트", "디저트"]
  ].filter(([keyword]) => text.includes(keyword)).map(([, value]) => value);

  const constraints = [];
  if (includesAny(text, ["오래 걷", "많이 걷", "멀지", "가까운", "지하철역"])) constraints.push("low_walking");
  if (includesAny(text, ["비", "실내", "춥", "덥"])) constraints.push("indoor_or_weather_safe");
  if (includesAny(text, ["조용", "자리 넓", "편한"])) constraints.push("quiet_comfortable");
  if (includesAny(text, ["비싼", "부담", "3만원", "저렴", "가성비"])) constraints.push("budget_sensitive");
  if (includesAny(text, ["늦게", "막차", "내일 일", "일찍"])) constraints.push("not_too_late");

  const mood = [];
  if (includesAny(text, ["조용", "편한", "자리 넓"])) mood.push("calm");
  if (includesAny(text, ["영화", "전시", "실내"])) mood.push("indoor");
  if (includesAny(text, ["가볍게", "잠깐"])) mood.push("light");

  return {
    ...timing,
    area,
    foods: [...new Set(foods)],
    constraints: [...new Set(constraints)],
    mood: [...new Set(mood)]
  };
}

function scoreSignalCompleteness(signals) {
  const checks = [
    signals.dateDay !== "unknown",
    signals.meetingTime !== "unknown" || signals.timeWindow !== "unknown",
    signals.area !== "unknown",
    signals.foods.length > 0,
    signals.constraints.length > 0
  ];
  return checks.filter(Boolean).length;
}

function buildCourses(signals) {
  const area = signals.area === "unknown" ? "선택 지역" : signals.area;
  const food = signals.foods.includes("파스타") ? "캐주얼 파스타" : signals.foods[0] || "가벼운 식사";
  const isEvening = ["evening", "late_night"].includes(signals.timeWindow);
  const indoor = signals.constraints.includes("indoor_or_weather_safe");
  const lowWalking = signals.constraints.includes("low_walking");
  const budget = signals.constraints.includes("budget_sensitive") ? "중저가" : "중간";
  const start = signals.meetingTime !== "unknown" ? signals.meetingTime : isEvening ? "18:00" : "14:00";

  const mainActivity = indoor ? "실내 영화 또는 늦게까지 여는 전시" : isEvening ? "짧은 야경 산책" : "소품샵 또는 전시";
  const cafe = signals.constraints.includes("quiet_comfortable") ? "조용하고 좌석 여유 있는 카페" : "근처 카페";

  return [
    {
      title: `${area} ${isEvening ? "저녁" : "오후"} ${food} 코스`,
      order: [`${start} ${food}`, cafe, mainActivity],
      duration: isEvening ? "2.5-3.5시간" : "3-4시간",
      costTier: budget,
      travelBurden: lowWalking ? "낮음" : "중간 이하",
      reviewTone: "mock: 분위기는 편안하고 가격 부담이 크지 않아 커플 데이트용으로 무난한 편.",
      fitReason: "대화에서 추출한 시간대, 음식 선호, 이동 부담, 분위기 조건을 우선 반영했습니다."
    },
    {
      title: `${area} 실내 안정 코스`,
      order: [`${start} 역 근처 식사`, "예약 가능한 실내 활동", cafe],
      duration: "3-4시간",
      costTier: budget,
      travelBurden: "낮음",
      reviewTone: "mock: 날씨 영향을 덜 받고 동선이 짧아 피곤한 날에도 진행하기 쉬운 구성.",
      fitReason: "비나 피곤함 같은 변수가 있어도 코스를 유지할 수 있게 실내 중심으로 구성했습니다."
    },
    {
      title: `${area} 짧고 편한 대화 중심 코스`,
      order: [`${start} 가벼운 식사`, "조용한 카페", "귀가 또는 짧은 산책"],
      duration: "2-3시간",
      costTier: "중저가",
      travelBurden: "낮음",
      reviewTone: "mock: 특별한 이벤트보다 대화와 휴식에 맞춘 차분한 데이트에 어울립니다.",
      fitReason: "오래 걷지 않고 늦게 끝나지 않는 조건을 가장 강하게 반영했습니다."
    }
  ];
}

function runLiveOcr() {
  return new Promise((resolve) => {
    execFile("/usr/bin/swift", [ocrTool], { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          checkedAt: new Date().toISOString(),
          lineCount: 0,
          text: "",
          error: stderr.trim() || error.message
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({
          ok: Boolean(parsed.ok),
          checkedAt: new Date().toISOString(),
          lineCount: parsed.lineCount || 0,
          text: parsed.text || "",
          error: parsed.error || null,
          windowName: parsed.windowName,
          windowID: parsed.windowID
        });
      } catch (parseError) {
        resolve({
          ok: false,
          checkedAt: new Date().toISOString(),
          lineCount: 0,
          text: "",
          error: parseError.message
        });
      }
    });
  });
}

function analyzeConversation(text, mtimeMs, roomOverride = null) {
  const roomHeader = roomOverride || text.match(/\[(.+?)\]/)?.[1] || "unknown";
  const analysisText = roomOverride ? text : text.replace(/^\[[^\]]+\]\s*/, "");
  const scoped = roomHeader === consent.approvedRoom;
  const secretsDetected = /(otp|인증번호|비밀번호|password|api[_-]?key|계좌번호|주민등록)/i.test(analysisText);

  if (!consent.userApproved || !scoped || secretsDetected) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      consent,
      stopReason: !consent.userApproved
        ? "user_not_approved"
        : !scoped
          ? "approved_room_not_verified"
          : "sensitive_data_detected",
      rawStored: false,
      sourceMtimeMs: mtimeMs
    };
  }

  const signals = extractSignals(analysisText);
  const completeness = scoreSignalCompleteness(signals);
  const courses = buildCourses(signals);
  const uncertainties = [];

  if (signals.dateDay === "unknown") uncertainties.push("정확한 날짜가 아직 없습니다.");
  if (signals.meetingTime === "unknown") uncertainties.push("정확한 만나는 시간이 없어 시간대 기준으로만 추천했습니다.");
  if (signals.area === "unknown") uncertainties.push("지역이 확정되지 않았습니다.");
  uncertainties.push("실제 영업시간, 예약 가능 여부, 리뷰 데이터는 외부 장소 API 연결 후 검증해야 합니다.");

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    consent,
    source: {
      file: "data/approved-room.txt",
      approvedRoom: roomHeader,
      sourceMtimeMs: mtimeMs,
      rawStored: false
    },
    datingBrief: {
      dateDay: signals.dateDay,
      meetingTime: signals.meetingTime,
      timeWindow: signals.timeWindow,
      durationHint: signals.durationHint,
      area: signals.area,
      foods: signals.foods,
      constraints: signals.constraints,
      mood: signals.mood,
      completeness
    },
    timeFitReasoning: [
      signals.timeWindow === "evening" ? "오후/저녁 만남으로 판단해 낮 전용 활동은 제외했습니다." : "확정된 시간대에 맞춰 활동 후보를 좁혔습니다.",
      signals.constraints.includes("low_walking") ? "오래 걷기 싫다는 조건 때문에 역 근처와 짧은 동선을 우선했습니다." : "이동 제약이 약해 2-3개 스팟 코스를 허용했습니다.",
      signals.constraints.includes("indoor_or_weather_safe") ? "비/실내 조건을 반영해 야외 산책 비중을 낮췄습니다." : "날씨 제약이 없으면 짧은 야외 옵션도 남겼습니다."
    ],
    courses,
    uncertainties,
    nextUpdateTrigger: "새 데이트 관련 문장, 시간 변경, 지역 변경, 날씨/예산/이동 제약 추가"
  };
}

async function getState() {
  if (liveOcr) {
    latestOcr = await runLiveOcr();
  }

  const currentStat = await stat(dataFile);
  if (cachedState && cachedMtimeMs === currentStat.mtimeMs && !liveOcr) {
    return cachedState;
  }

  const fileText = await readFile(dataFile, "utf8");
  const text = latestOcr.ok && latestOcr.text
    ? latestOcr.text
    : fileText;
  cachedMtimeMs = currentStat.mtimeMs;
  cachedState = analyzeConversation(text, currentStat.mtimeMs, latestOcr.ok ? consent.approvedRoom : null);
  cachedState.liveOcr = {
    enabled: liveOcr,
    checkedAt: latestOcr.checkedAt,
    ok: latestOcr.ok,
    lineCount: latestOcr.lineCount,
    error: latestOcr.error,
    windowName: latestOcr.windowName,
    windowID: latestOcr.windowID
  };
  return cachedState;
}

async function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  }[ext] || "application/octet-stream";

  res.writeHead(200, { "content-type": contentType });
  createReadStream(filePath).on("error", () => {
    res.writeHead(404);
    res.end("Not found");
  }).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/state") {
      await sendJson(res, await getState());
      return;
    }

    if (req.url === "/api/demo-message" && req.method === "POST") {
      const message = demoMessages[Math.floor(Math.random() * demoMessages.length)];
      await appendFile(dataFile, `\n${message}`, "utf8");
      cachedState = null;
      await sendJson(res, { added: message, state: await getState() });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    await sendJson(res, { ok: false, error: error.message }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Kakao Date Companion running at http://127.0.0.1:${port}`);
});
