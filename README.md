# Kakao Export Date Planner

Skillathon submission for a Codex Skill that turns a **user-approved KakaoTalk exported `.txt` file** into concrete date-course recommendations, persona-based approval scoring, and paste-ready KakaoTalk reply drafts.

The safe default flow is export-based. This repo does **not** read KakaoTalk internal databases, does **not** use screen capture, and does **not** send messages automatically.

## Submission Skill

- Main Skill: `skills/kakao-export-date-planner/SKILL.md`
- Submission write-up: `SUBMISSION.md`
- Sample report: `report.md`
- Local date-course memory DB: `data/date-memory.json`

## Consent Scope

Required input scope:

- `chat_export_file`: a KakaoTalk `.txt` export provided by the user
- `approved_contact_or_room`: the specific contact or chatroom the user approves for analysis
- `planning_goal`: `date_course_recommendation`

The Skill processes only the approved export and approved contact/room. It stores course metadata, place candidates, scores, and message drafts, but it does **not** store raw KakaoTalk chat.

## Quick Verification

Run the deterministic sample:

```bash
npm run analyze:sample
```

Expected outputs:

- `report.md` is regenerated.
- `data/date-memory.json` is updated.
- The report extracts date/time/area/preferences from `data/sample-kakao-export.txt`.
- It generates concrete places, approval scores, source-channel status, and paste-ready KakaoTalk message drafts.

## Export Inbox Mode

To reduce user effort, run:

```bash
npm run watch:exports
```

Then place a user-approved KakaoTalk export `.txt` file in:

```txt
data/inbox
```

The watcher picks the newest export, runs the Skill demo analyzer, and updates:

- `data/reports/latest-report.md`
- `report.md`

This keeps the flow safe and reproducible while reducing the user action to: **export chat → drop file into inbox → paste suggested reply**.

## What The Skill Does

From the approved export, it infers:

- date and meeting time
- area and travel hints
- food/cafe/activity preferences
- budget sensitivity
- weather and walking constraints
- visited/wanted/disliked areas
- partner date persona
- user message persona

Then it produces:

- ranked area/place candidates
- concrete date courses
- Naver Map / Naver Blog / Instagram / official-page source status
- Persona Judge approval score and approval rate
- Fast Reply Card for KakaoTalk
- persistent date-course memory updates

## Concrete Place Research

The sample uses `references/seongsu-place-research.md` as bundled reference data. Sample course stops are concrete places, not generic placeholders:

- `투파인드피터 서울성수점`
- `연남토마 성수점`
- `성수 비아트`
- `히어로보드게임카페 성수점`

For real usage, set `external_search=allowed` in a Codex run and verify current information through summarized queries only. Raw KakaoTalk text must not be sent to web search.

Source channels are separated:

- Naver Map: current hours, distance, visitor reviews, reservation/waiting, menu/price
- Naver Blog: long-form reviews, date-course context, sponsorship risk, repeated pros/cons
- Instagram: public location/tag atmosphere and photo/crowding hints only
- Official pages: hours, reservations, menus, notices

## Date Course Memory DB

`data/date-memory.json` stores:

- suggested courses
- concrete places
- approval scores and score history
- course status such as `suggested`, `selected`, `visited`, `liked`, `rejected`
- message draft used
- summarized persona snapshots
- summarized search query history

It does not store raw chat. Future runs can reuse this DB to avoid repeating rejected/overused courses, rescore old courses against an updated partner persona, and shorten repeated place research.

## Safety Guardrails

- Analyze only user-provided KakaoTalk exports.
- Process only the approved contact or room.
- Do not access KakaoTalk internal files, encrypted databases, credentials, hidden messages, or screenshots.
- Do not send raw KakaoTalk messages to external services.
- Use summarized search queries only.
- Do not scrape private Instagram accounts or bypass login.
- Redact or stop on passwords, OTPs, API keys, account numbers, resident registration numbers, or secrets.
- Message drafts are editable suggestions; the Skill never sends messages automatically.
