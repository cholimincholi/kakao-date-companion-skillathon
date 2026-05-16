# Skillathon Submission: Kakao Export Date Planner

## Skill Name

`kakao-export-date-planner`

## One-line Summary

사용자가 제공한 카카오톡 내보내기 파일에서 데이트 조건을 추출하고, 데이트 취향 페르소나와 Persona Judge approval rate를 사용해 데이트 코스를 자동 추천하는 Skill입니다.

## Problem

데이트 코스를 정할 때 사용자는 이미 카카오톡에서 시간, 지역, 음식 취향, 예산 부담, 이동 제약을 많이 이야기합니다. 하지만 그 정보를 다시 정리하고, 장소를 찾고, 리뷰를 읽고, 코스를 조합하는 과정이 번거롭습니다.

이 Skill은 카카오톡 대화 export를 입력으로 받아 데이트 관련 맥락만 구조화하고, 사용자가 부족한 옵션을 직접 입력하지 않아도 대화에서 최대한 추론합니다.

## Target User

- 연인과의 대화에서 데이트 코스 후보를 빠르게 만들고 싶은 사용자
- 카카오톡 대화를 직접 붙여넣기보다 export 파일 또는 inbox 폴더 기반으로 자동 분석하고 싶은 사용자
- Skillathon 평가 기준에 맞는 재현 가능하고 안전한 데모를 제출하려는 사용자

## Input Contract

Required:

- `chat_export_file`: 사용자가 제공한 카카오톡 `.txt` 내보내기 파일
- `approved_contact_or_room`: 사용자가 분석을 승인한 상대 또는 채팅방
- `planning_goal`: `date_course_recommendation`

Optional, inferred first:

- `date_window`
- `target_area`
- `budget_level`
- `transport_preference`
- `avoid`
- `external_search`: `allowed`, `ask_first`, `not_allowed`
- `output_format`: `markdown`, `json`, `both`

## Output Contract

The Skill produces:

- Input Scope
- Extracted Date Signals
- Partner Date Persona
- User Message Persona
- Missing Context and Assumptions
- Search Queries Used or To Approve
- Location Memory and Area Ranking
- Place Research Candidates
- Naver Map / Naver Blog / Instagram source status
- Recommended Date Courses
- Persona Approval Review
- Approval Rate
- KakaoTalk Message Drafts
- Fast Reply Card
- Date Course Memory
- Verification Needed
- JSON Summary

## Low-intervention Automation

The main reproducible mode is an export inbox:

1. User exports KakaoTalk chat as `.txt`.
2. User drops the file into `data/inbox`.
3. `watch_exports.js` detects the newest export.
4. `export_analyzer.js` generates `data/reports/latest-report.md`.
5. `report.md` is updated for quick review.

This keeps the submission safe and reproducible while reducing user involvement to one export/drop action.

When the chat only says something broad like "오빠 우리 다음주에 어디갈까? 뭐하고 싶어?", the Skill should:

1. Detect early date-planning intent.
2. Extract `date_window=next_week`.
3. Look back through the same export for visited/wanted/disliked areas and distance hints.
4. Produce starter options if enough history exists.
5. Ask only one short follow-up if the plan is blocked, usually "어느 동네에서 만날까요?" or "낮/저녁 중 언제가 좋아요?"

## Persona Judge Flow

The Skill uses two logical agents:

- Planner Agent: extracts date signals, builds the dating-preference persona, and drafts course candidates.
- Persona Judge Agent: evaluates each course using only the persona, extracted signals, and course details.

The Judge returns:

- `approval_decision`: `approve`, `soft_approve`, or `disapprove`
- `approval_score`: 0-100
- `matched_preferences`
- `concerns`
- `recommended_adjustments`

The final `approval_rate` is the average score across course options.

## Message Draft Flow

After ranking courses, the Skill generates editable KakaoTalk message drafts:

- `short_casual`: quick "여기 어때?" proposal
- `warm_explained`: explains why the course fits
- `two_options`: gives the partner two choices

The Skill must not send the message automatically. The user reviews, edits, and sends it manually.

Message drafts combine two personas:

- Partner Persona: date preferences such as quiet places, low walking, budget sensitivity, time window, and disliked areas.
- User Persona: the user's KakaoTalk proposal tone, for example short/casual, gentle/explained, choice-based, use of `ㅋㅋ`, `ㄱㄱ`, endings like `어때` or `좋을듯`, and average message length.

The draft should sound like the user while respecting what the partner is likely to prefer.

## Fast Reply Mode

For the fastest user loop, the Skill supports `reply_mode=fast_reply` or `reply_mode=both`.

When a message like "오빠 우리 다음주에 어디갈까? 뭐하고 싶어?" appears, the Skill should not wait for the user to manually brainstorm. It should:

1. Detect that the partner is asking for a date idea.
2. Look back at location memory and persona evidence.
3. Pick the top course and one fallback.
4. Generate one best paste-ready KakaoTalk reply.
5. Let the user paste it into the chat and continue the conversation.

This shortens the loop from "think → search → compare → write" to "export/drop → paste suggested reply".

## Date Course DB

The Skill maintains a lightweight local JSON DB at `data/date-memory.json`.

It stores:

- suggested courses
- concrete places
- approval scores
- approval score history
- course status
- message draft used
- summarized persona snapshots
- summarized search query history
- first seen and last updated timestamps

It does not store raw KakaoTalk messages. The DB lets future runs avoid repeating rejected or overused places, reuse liked places when appropriate, re-score old courses against updated partner personas, and shorten future research by reusing previous query/place context.

## Safety Rules

- Analyze only user-provided export files.
- Process only the approved contact or room.
- Do not access KakaoTalk internal databases, encrypted files, credentials, or hidden messages.
- Do not send raw KakaoTalk messages to web search or external APIs.
- Use summarized search queries only.
- Do not leave final recommendations as generic "nearby restaurant/cafe" labels when place research is available.
- Analyze Naver Map, Naver Blog, Instagram public posts, and official pages as separate evidence channels when available.
- Do not scrape private Instagram accounts or bypass login.
- Redact or stop on passwords, OTPs, API keys, account numbers, resident registration numbers, or other secrets.
- Treat the persona as a date-preference hypothesis, not a psychological or relationship judgment.

## Verification

Run:

```bash
npm run analyze:sample
```

Expected:

- `report.md` is generated.
- Date is extracted as `토요일`.
- Meeting time is extracted as `17:00`.
- Area is extracted as `성수`.
- Food/place preferences include `파스타`, `카페`.
- Constraints include budget sensitivity, low walking, weather-safe/indoor, quiet/comfortable.
- Location memory ranks `성수` and `한남` above overused/disliked `홍대`.
- Concrete place candidates and reasons are included.
- Place research includes source-channel status for Naver Map, Naver Blog, Instagram, and verification needs.
- At least two date courses are generated.
- Each course includes approval decision and score.
- Overall approval rate is included.
- Editable KakaoTalk message drafts are included.
- Date course memory is updated without raw chat.
- Existing course scores are updated from the latest partner persona.
- Search/query history is summarized for future runs.

Watch mode:

```bash
npm run watch:exports
```

Then place a `.txt` KakaoTalk export in `data/inbox`.

## Current Limitations

- Real web/blog search is gated behind `external_search: allowed`; the sample run only generates search queries.
- Place opening hours, prices, ratings, and reservation availability must be verified with current sources.
- KakaoTalk real-time background reading is not part of the safe default Skill. PC OCR is included only as an optional extension demo.

## Extension Plan

- Add official map/place API integration.
- Add blog review source collection with citations.
- Add weather-aware course filtering.
- Add calendar/reminder export.
- Add optional PC OCR companion mode for visible text only.
