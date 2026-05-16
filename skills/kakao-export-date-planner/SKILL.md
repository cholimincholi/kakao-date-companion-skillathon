---
name: kakao-export-date-planner
description: Use when analyzing a user-provided KakaoTalk exported chat file to infer date-planning context, build a dating-preference persona, optionally research places/blog reviews, and produce time-aware date course recommendations.
---

# Kakao Export Date Planner

## Purpose

This skill turns a user-provided KakaoTalk exported chat file into a practical date planning report.

The user does not need to provide every option. Infer date, area, time window, budget level, transport preference, dislikes, and activity preferences from the chat when possible. Ask follow-up questions only when the missing context blocks useful course planning.

This skill may create a girlfriend/boyfriend dating-preference persona, but only as a planning aid. Do not make broad psychological, medical, financial, or relationship judgments.

## Required Inputs

- `chat_export_file`: path to a user-provided KakaoTalk `.txt` export file
- `approved_contact_or_room`: contact or room name approved by the user
- `planning_goal`: usually `date_course_recommendation`

If any required input is missing, stop and ask for it.

## Optional Inputs

Infer these from the chat first. Ask the user only if the value is necessary and cannot be inferred.

- `date_window`: today, tomorrow, this weekend, Saturday, evening, after work, or a specific date
- `target_area`: area such as 성수, 홍대, 강남, 잠실, 부산 서면
- `budget_level`: low, medium, high, or an amount
- `transport_preference`: walking, subway, taxi, car, or no preference
- `avoid`: waiting, alcohol, outdoor, spicy food, long walking, crowded places, late night
- `external_search`: `allowed`, `ask_first`, or `not_allowed`
- `output_format`: markdown, json, or both
- `reply_mode`: `fast_reply`, `report`, or `both`
- `memory_file`: optional local JSON DB path for date course memory

## Consent and Scope

- Process only the user-provided export file.
- Process only the approved contact or room.
- Do not access KakaoTalk internal databases, credentials, encrypted files, or hidden conversations.
- Do not send raw KakaoTalk messages to external services or search engines.
- If external search is allowed, use only summarized planning queries.
- Store or output summarized planning signals by default, not the full raw chat.

## Workflow

1. Validate inputs.
   - Confirm the export file exists and is readable.
   - Confirm the approved contact or room.
   - Stop if the user asks to analyze a file they are not authorized to use.

   Low-intervention mode:
   - If the user provides an export inbox folder instead of a single file, watch or scan the folder for the newest KakaoTalk `.txt` export.
   - Re-run the analysis when a newer export file appears.
   - Do not require the user to restate date, budget, area, transport, or avoid options if they can be inferred from the chat.
   - Ask follow-up questions only when no useful course can be generated.

2. Scan for safety issues.
   - Stop or redact if the file contains passwords, OTPs, API keys, account numbers, resident registration numbers, or other secrets.
   - Ignore unrelated private content.
   - Do not quote long private chat passages.

3. Extract date-planning signals.
   - Extract date/day, meeting time, time window, area, food, drinks, activities, mood, budget hints, transport constraints, weather constraints, dislikes, and mentioned places.
   - Extract location memory:
     - `visited_places`
     - `unvisited_places`
     - `wanted_places`
     - `disliked_places`
     - `repeated_areas`
     - `distance_hints`
     - `base_location`
   - Mark each signal as `explicit`, `inferred`, or `unknown`.
   - Prefer recent messages when old and recent preferences conflict.

4. Build dating and messaging personas.
   - Build the partner persona only from date-relevant evidence.
   - Build the user's message persona only from the user's own chat style and planning habits.
   - Include for the partner:
     - preferred date mood
     - food and cafe preferences
     - movement tolerance
     - budget sensitivity
     - time-of-day preference
     - avoid list
     - confidence level
     - message tone hints
   - Include for the user:
     - message tone
     - proposal style
     - directness level
     - whether they usually ask for preference before deciding
     - recent endings such as `어때`, `갈까`, `볼까`, `ㄱㄱ`, `좋을듯`
     - average message length
     - use of laughter such as `ㅋㅋ` or `ㅎㅎ`
     - use of Korean initial consonants/short slang
     - preferred address terms such as names, `우리`, or other user-provided terms
     - confidence level
   - Do not infer sensitive traits, attachment style, mental health, wealth, family background, religion, politics, or relationship satisfaction.
   - Phrase both personas as hypotheses, not facts.

5. Resolve missing context.
   - If date/time is unknown, create separate time-window variants.
   - If area is unknown, infer likely areas from repeated mentions.
   - If the chat only says something like `다음주에 어디갈까?` or `뭐하고 싶어?`, treat it as an early planning intent and generate broad starter options instead of forcing the user to fill every option.
   - If budget is unknown, use a medium-cost default and label it as an assumption.
   - Ask at most 3 follow-up questions only when no useful plan can be produced.
   - In `fast_reply` mode, prefer making a useful proposal immediately over asking the user for optional context.

6. Rank areas and places.
   - Prefer places or areas the partner says they want to visit.
   - Prefer unvisited/wanted places over overused places unless the chat shows strong revisit preference.
   - Lower priority for places described as too crowded, too far, too expensive, boring, or visited too often.
   - If a base location is known, rank by estimated distance or travel time when map/search data is allowed.
   - If base location is unknown, rank by conversation evidence and mark distance as `unknown` or `inferred`.
   - If the user has not provided a location yet, ask for one short anchor only when exact distance ranking is needed.

7. Load date course memory.
   - If `memory_file` is provided or a default local date memory DB exists, load previous course and place summaries.
   - Track only planning metadata:
     - course title
     - places
     - area
     - date/day
     - approval score
     - score history
     - status: `candidate`, `suggested`, `selected`, `visited`, `liked`, `rejected`, or `avoid`
     - message draft used
     - persona snapshot
     - summarized search query history
     - notes
   - Use memory to avoid repeatedly suggesting rejected or overused courses.
   - Allow liked or explicitly requested places to be resurfaced.
   - When a new export changes the partner persona, re-score existing courses against the updated persona.
   - Reuse previous search queries and place candidates to shorten future research.
   - Do not store raw KakaoTalk messages in memory.

8. External place and blog research.
   - Run this step only when `external_search` is `allowed`; if it is `ask_first`, ask before searching.
   - Search with summarized queries only, for example:
     - `성수 토요일 저녁 파스타 조용한 카페 데이트`
     - `성수 비오는 날 실내 데이트 영화 전시 카페`
   - Research place candidates, blog reviews, map snippets, official pages, menus, hours, reservation notes, and recent review tone.
   - Treat blogs as subjective and possibly sponsored.
   - Do not claim exact hours, prices, availability, or ratings unless a current source supports it.
   - Cite sources when search was used.
   - If search is not allowed yet, output `Search Queries To Approve` so the user can approve one click/one message later.
   - Do not leave final course stops as generic labels like `근처 식사`, `파스타 식당`, or `조용한 카페` when search or bundled references are available.
   - Each recommended stop should include:
     - concrete place name
     - place type
     - why it matches the chat/persona
     - one-line review/blog summary
     - source status: `live_verified`, `bundled_reference`, `provided`, or `needs_verification`
     - verification needed

9. Generate date courses.
   - Create 2-3 course options.
   - Each course must include:
     - title
     - target persona fit
     - stop order
     - concrete place names when available
     - suggested schedule
     - estimated duration
     - rough cost level
     - travel burden
     - visited/unvisited status when known
     - distance rank or distance uncertainty
     - one-line review/blog summary
     - why it fits the chat
     - verification needed

10. Run persona approval evaluation.
   - Treat the date-preference persona as a separate reviewer.
   - A second Codex agent, or an isolated evaluator prompt, should judge each course as `approve`, `soft_approve`, or `disapprove`.
   - The evaluator must use only the persona, extracted signals, and course details.
   - The evaluator must not invent new preferences.
   - The evaluator must return:
     - `approval_decision`
     - `approval_score`: 0-100
     - `matched_preferences`
     - `concerns`
     - `recommended_adjustments`
   - Calculate `approval_rate` as the average score across course options.
   - Rank courses by `approval_score`, then by time fit, then by verification confidence.

11. Generate KakaoTalk message drafts.
   - Create 2-3 message drafts the user can send manually.
   - Do not send messages automatically.
   - Drafts must combine:
     - partner persona: what kind of date proposal is likely to feel comfortable
     - user persona: how the user naturally writes in KakaoTalk
   - Draft styles:
     - `short_casual`: quick proposal
     - `warm_explained`: gentle proposal with reason
     - `two_options`: lets the partner choose between top options
   - Keep the tone natural, respectful, and easy to edit.
   - Match the user's usual directness, sentence length, endings, and casual markers when confidence is medium or higher.
   - Do not include private analysis, persona labels, approval scores, or hidden reasoning in the message draft.
   - If facts are not verified, avoid claiming exact opening hours, ratings, or prices.

12. Fast reply handoff.
   - If `reply_mode` is `fast_reply` or `both`, output a `Fast Reply Card`.
   - The card must contain:
     - top recommendation
     - 1 alternative
     - one best message to paste
     - one shorter message
     - what changed since the previous export, if known
   - The goal is to let the user paste a good reply into KakaoTalk within 10 seconds.

13. Update date course memory.
   - Store generated course summaries and place candidates in the local memory DB.
   - Store a summarized persona snapshot and search query history.
   - Re-score previously remembered courses when the partner persona changes.
   - Do not store raw KakaoTalk messages.
   - Keep enough metadata to support future ranking, deduplication, search shortening, and status updates.

14. Output the report.
   - Provide Markdown for human review.
   - Provide JSON when the user wants app integration.
   - Include uncertainties and assumptions.

## Output Contract

Return these sections:

1. `Input Scope`
2. `Extracted Date Signals`
3. `Dating Personas`
4. `Missing Context and Assumptions`
5. `Location Memory and Area Ranking`
6. `Place Research Candidates`
7. `Search Queries Used` if external search was allowed
8. `Recommended Date Courses`
9. `Persona Approval Review`
10. `Approval Rate`
11. `KakaoTalk Message Drafts`
12. `Fast Reply Card`
13. `Date Course Memory`
14. `Search Tracking`
15. `Place/Blog Review One-liners`
16. `Verification Needed`
17. `JSON Summary` if requested

## Stop Conditions

Stop immediately if:

- The export file is missing.
- The user is not authorized to use the chat data.
- The user asks to secretly monitor or analyze another person's messages.
- The input contains secrets that cannot be safely redacted.
- External search would expose raw private chat.

## Verification Checklist

A run is successful if:

- Required inputs are present.
- Raw chat is not sent to web search.
- Date/time/area/budget/transport preferences are extracted or explicitly marked unknown.
- Visited/wanted/disliked place signals are extracted or marked unknown.
- Distance ranking is based on either map/search data or clearly labeled conversation inference.
- The persona is limited to date preferences and includes confidence.
- The user's message persona is based only on the user's own messages.
- At least two time-aware courses are generated.
- Course stops use concrete place names when search or bundled references are available.
- Each course has a persona approval decision and score.
- The report includes an overall approval rate.
- The report includes editable KakaoTalk message drafts.
- `fast_reply` mode includes a single best paste-ready message.
- Course and place memory is updated without storing raw chat.
- Existing course scores are refreshed when the partner persona changes.
- Search history is summarized so future research can avoid repeating the same work.
- Blog/review claims are labeled with source status.
- Assumptions and verification-needed items are visible.

For low-intervention inbox mode:

- The newest `.txt` export is selected deterministically.
- A report is regenerated when a new export appears.
- No raw chat is sent to external search.
- Missing optional context is inferred first and only asked about when blocking.

## Persona Judge Prompt

Use this prompt when delegating course evaluation to another Codex agent:

```text
You are a persona approval judge for date course recommendations.

Inputs:
- Dating-preference persona
- Extracted date signals
- Candidate course

Task:
- Decide whether this persona would likely approve the course.
- Use only the provided persona and extracted signals.
- Do not infer sensitive relationship, psychological, medical, or financial facts.
- Return JSON with:
  - approval_decision: approve | soft_approve | disapprove
  - approval_score: integer 0-100
  - matched_preferences: string[]
  - concerns: string[]
  - recommended_adjustments: string[]

Scoring guide:
- 90-100: strongly matches time, area, mood, budget, and movement constraints
- 75-89: good fit with minor uncertainty
- 60-74: usable but needs adjustment
- 40-59: weak fit with meaningful mismatch
- 0-39: should not recommend
```

## Mock Input

```yaml
chat_export_file: data/sample-kakao-export.txt
approved_contact_or_room: 희영이
planning_goal: date_course_recommendation
external_search: ask_first
output_format: both
```

## Expected Behavior

- Infer that the date is after work or evening if the chat mentions `끝나고`, `오후`, or `저녁`.
- Infer low walking tolerance from `오래 걷기 싫어`, `가까운 데`, or `역 근처`.
- Build a persona such as: `조용하고 무리 없는 동선을 선호하며, 저녁 식사와 카페 중심의 편한 데이트를 좋아할 가능성이 높음`.
- Generate evening-focused courses instead of brunch or morning courses.
