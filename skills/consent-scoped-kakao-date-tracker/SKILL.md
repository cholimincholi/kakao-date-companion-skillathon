---
name: consent-scoped-kakao-date-tracker
description: Use when processing user-approved PC KakaoTalk visible text, notifications, or exported logs from a specific chatroom to update time-aware date course recommendations.
---

# Consent-Scoped Kakao Date Tracker

## Purpose

This skill analyzes user-approved KakaoTalk-derived text from one specific contact or room and updates date course recommendations. It is designed for local companion apps, mock demos, notification logs, visible text OCR, or exported logs.

It must not claim direct access to KakaoTalk private databases, credentials, encrypted files, hidden conversations, or unapproved contacts.

## Required Inputs

- `user_approved`: must be `true`
- `approved_source`: `pc_visible_text`, `notification_log`, `exported_chat`, `screenshot_ocr`, or `mock_data`
- `approved_contact_or_room`: one specific contact, room name, or anonymized room ID
- `approved_purpose`: must be `date_course_planning`
- `conversation_text`: KakaoTalk-derived text from the approved source

## Optional Inputs

- `city_or_area`
- `budget_level`
- `transport_preference`
- `avoid`
- `update_frequency`
- `retention_mode`: `no_raw_storage`, `session_only`, or `user_saved_summary`

## Workflow

1. Verify consent and scope.
   - Continue only when `user_approved` is `true`.
   - Process only the approved contact or chatroom.
   - Stop if the source or room cannot be verified.

2. Remove unsafe or unrelated content.
   - Ignore non-date-related personal conversation.
   - Stop processing a message if it contains passwords, OTPs, API keys, account numbers, or other secrets.
   - Do not store raw chat by default.

3. Extract date-planning signals.
   - Extract date, day, meeting time, time window, area, food, mood, budget hints, transport constraints, weather constraints, dislikes, and mentioned places.
   - Mark uncertain values as `unknown` or `inferred`.

4. Apply time-aware planning.
   - If the date starts in the afternoon or evening, exclude morning-only or lunch-only ideas.
   - If the conversation mentions after-work, tiredness, or light plans, keep the route short.
   - If opening hours are unavailable, mark venues as `needs_time_verification`.

5. Update recommendations.
   - Generate 2-3 course candidates.
   - Each course must include order, estimated duration, rough cost tier, travel burden, why it fits, and one-line review tone.
   - Update only when new date-related signals appear.

6. Report verification status.
   - Include what source was checked, whether new signals were found, what changed, and what remains uncertain.

## Stop Conditions

Stop immediately if:

- `user_approved` is not `true`.
- The requested source is outside the approved scope.
- The user asks to secretly monitor someone else's messages.
- The input contains multiple rooms and the approved room cannot be identified.
- The input includes passwords, OTPs, API keys, account numbers, or private financial details.
- External API calls would expose private chat without explicit approval.

## Verification Checklist

A run is successful if:

- Required consent fields are present.
- Only the approved room/source is processed.
- Meeting time is extracted or marked as `unknown`.
- Recommendations match the extracted time window.
- At least two course options are generated.
- Review summaries are labeled as mock, provided, verified, or unavailable.
- Sensitive data is removed or ignored.
- Missing facts are clearly marked.

## Mock Input

```yaml
user_approved: true
approved_source: pc_visible_text
approved_contact_or_room: 성수 데이트방
approved_purpose: date_course_planning
city_or_area: 성수
budget_level: medium
conversation_text: |
  [성수 데이트방]
  A: 토요일 오후 5시 어때?
  B: 좋아. 파스타 먹고 싶고 너무 많이 걷긴 싫어.
  A: 비 오면 실내로 가자.
```

## Expected Output

- date_day: 토요일
- meeting_time: 17:00
- time_window: evening
- area: 성수
- food: 파스타
- constraints: 실내, 도보 적게
- recommendation: evening indoor low-walking course
