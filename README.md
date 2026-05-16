# Kakao Date Companion MVP

승인된 PC 카카오톡 대화 소스만 처리한다는 가정의 Skillathon용 로컬 MVP입니다.

이 앱은 실제 카카오톡 내부 데이터베이스에 접근하지 않습니다. `data/approved-room.txt`를 승인된 PC 카톡 visible text/mock source로 보고, 5초마다 읽어서 데이트 관련 신호를 추출합니다.

## 실행

```bash
npm start
```

브라우저에서 `http://localhost:4173`을 엽니다.

실제 PC 카카오톡 창 OCR을 켜려면 카카오톡 채팅방을 화면에 열어둔 뒤:

```bash
KAKAO_LIVE_OCR=1 npm start
```

macOS에서 화면 기록 권한을 요청할 수 있습니다. 이 모드는 카카오톡 내부 DB를 읽지 않고, 사용자가 화면에 띄운 KakaoTalk 창을 캡처해 Vision OCR로 visible text만 분석합니다.

## 데모 방법

1. 앱을 실행합니다.
2. 화면에서 승인 범위가 `성수 데이트방`인지 확인합니다.
3. `새 카톡 문장 추가`를 누르면 승인된 방의 새 메시지처럼 `data/approved-room.txt`에 문장이 추가됩니다.
4. 앱이 5초 주기로 날짜, 시간대, 지역, 음식, 이동/날씨/예산 제약을 다시 분석하고 코스를 업데이트합니다.

## Skill 품질 기준 반영

- 재현성: mock input, required inputs, workflow, expected output을 `skills/consent-scoped-kakao-date-tracker/SKILL.md`에 명시했습니다.
- 안전성: 승인된 방만 처리하고, 비밀값/OTP/계좌번호 감지 시 중단합니다.
- 검증 가능성: UI의 검증 상태와 `/api/state` JSON에서 처리 범위, 불확실성, 다음 업데이트 조건을 확인할 수 있습니다.

## 실제 제품화 시 연결 지점

- PC 카톡 visible text OCR
- OS 알림 로그
- 사용자가 승인한 exported chat file watcher
- 장소 API, 리뷰 API, 날씨 API

외부 API로 원문 대화를 보내기 전에는 payload preview와 사용자 승인을 추가해야 합니다.

## 카카오톡 내보내기 파일 분석 Skill

`skills/kakao-export-date-planner/SKILL.md`는 사용자가 제공한 카카오톡 내보내기 파일을 기준으로 데이트 조건을 추론하고, 데이트 취향 페르소나와 코스 추천 리포트를 만드는 Skill입니다.

로컬 mock 실행:

```bash
npm run analyze:sample
```

이 스크립트는 실제 웹 검색은 하지 않고, Skill이 사용할 검색 쿼리와 리포트 구조를 재현합니다. Codex가 이 Skill을 실제로 사용할 때 `external_search: allowed`가 있으면 원문이 아니라 요약된 조건만으로 웹/블로그 검색을 수행합니다.

## 덜 귀찮은 Export Inbox 모드

실시간 카카오톡 내부 접근 대신, 안전하고 재현 가능한 자동화 방식으로 `data/inbox` 폴더를 감시할 수 있습니다.

```bash
npm run watch:exports
```

그 다음 사용자는 카카오톡 내보내기 `.txt` 파일을 `data/inbox`에 넣기만 하면 됩니다. 앱은 최신 export 파일을 자동으로 분석하고 `data/reports/latest-report.md`와 `report.md`를 갱신합니다.

이 방식은 사용자가 매번 날짜/예산/지역을 입력하지 않아도 대화에서 최대한 추론하므로, “내보내기 파일 기반”의 안전성은 유지하면서 개입은 줄입니다.

예를 들어 카톡에 `오빠 우리 다음주에 어디갈까? 뭐하고 싶어?`만 새로 생겨도, Skill은 이전 대화 기록에서 가본 곳/안 가본 곳/가보고 싶은 곳/멀거나 자주 간 곳을 찾아 지역 후보를 정렬합니다. 정보가 부족하면 바로 멈추지 않고 기본 후보를 만든 뒤, 정말 필요한 경우에만 짧은 질문을 남깁니다.

리포트에는 사용자가 바로 카톡에 보낼 수 있는 메시지 초안도 포함됩니다. 자동 전송은 하지 않고, 사용자가 보고 수정해서 보내는 방식입니다.

`reply_mode=both` 기준으로 리포트에는 `Fast Reply Card`도 포함됩니다. 이 카드는 사용자가 길게 읽지 않고 바로 카카오톡에 붙여넣을 수 있는 추천 메시지 하나와 짧은 버전을 제공합니다.

성수 샘플에는 `references/seongsu-place-research.md`의 번들 장소 리서치를 사용합니다. 따라서 샘플 코스도 `근처 식사`가 아니라 `투파인드피터 서울성수점`, `성수 비아트`, `히어로보드게임카페 성수점`처럼 구체적인 후보와 선정 이유를 포함합니다. 실제 사용 시에는 `external_search=allowed`로 최신 블로그/지도/공식 페이지 검증을 추가해야 합니다.

## 데이트 코스 DB

분석을 실행하면 `data/date-memory.json`에 코스와 장소 후보가 누적됩니다.

저장하는 것:

- 코스 제목
- 장소명
- 지역
- approval score
- suggested/selected/visited/liked/rejected 같은 상태
- 사용한 메시지 초안

저장하지 않는 것:

- 카카오톡 원문
- 민감 정보
- 전체 대화 로그

이 DB는 다음 추천에서 이미 제안한 코스, 자주 나온 장소, 거절/선호 상태를 반영하는 데 사용합니다.

## 제출 문서

최종 제출 설명은 `SUBMISSION.md`에 정리되어 있습니다.
