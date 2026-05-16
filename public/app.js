const statusEl = document.querySelector("#status");
const briefEl = document.querySelector("#brief");
const reasoningEl = document.querySelector("#reasoning");
const coursesEl = document.querySelector("#courses");
const verificationEl = document.querySelector("#verification");
const demoButton = document.querySelector("#demo-button");

const labelMap = {
  dateDay: "날짜",
  meetingTime: "만나는 시간",
  timeWindow: "시간대",
  durationHint: "길이",
  area: "지역",
  foods: "음식",
  constraints: "제약",
  mood: "분위기",
  completeness: "완성도"
};

function formatValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "unknown";
  return String(value ?? "unknown");
}

function renderState(state) {
  document.querySelector("#approved-room").textContent = state.consent.approvedRoom;
  document.querySelector("#approved-source").textContent = state.consent.approvedSource;
  document.querySelector("#retention-mode").textContent = state.consent.retentionMode;

  if (!state.ok) {
    statusEl.textContent = "중단됨";
    statusEl.className = "status warn";
    briefEl.innerHTML = "";
    reasoningEl.innerHTML = "";
    coursesEl.innerHTML = "";
    verificationEl.innerHTML = `<p class="warn">중단 사유: ${state.stopReason}</p>`;
    return;
  }

  statusEl.textContent = "업데이트됨";
  statusEl.className = "status ok";

  briefEl.innerHTML = Object.entries(state.datingBrief)
    .map(([key, value]) => `<dt>${labelMap[key] || key}</dt><dd>${formatValue(value)}</dd>`)
    .join("");

  reasoningEl.innerHTML = state.timeFitReasoning
    .map((text) => `<p>${text}</p>`)
    .join("");

  coursesEl.innerHTML = state.courses
    .map((course) => `
      <article class="course">
        <h3>${course.title}</h3>
        <div class="meta">
          <span class="pill">${course.duration}</span>
          <span class="pill">비용 ${course.costTier}</span>
          <span class="pill">이동 ${course.travelBurden}</span>
        </div>
        <ol>${course.order.map((item) => `<li>${item}</li>`).join("")}</ol>
        <p>${course.fitReason}</p>
        <p>${course.reviewTone}</p>
      </article>
    `)
    .join("");

  verificationEl.innerHTML = `
    <p><strong>확인 시각:</strong> ${new Date(state.checkedAt).toLocaleString("ko-KR")}</p>
    <p><strong>처리 범위:</strong> ${state.source.approvedRoom} / 원문 저장 ${state.source.rawStored ? "있음" : "없음"}</p>
    ${state.liveOcr ? `<p><strong>실제 카톡 OCR:</strong> ${state.liveOcr.enabled ? (state.liveOcr.ok ? `연결됨, ${state.liveOcr.lineCount}줄 인식` : `실패: ${state.liveOcr.error}`) : "꺼짐"}</p>` : ""}
    <p><strong>다음 업데이트 조건:</strong> ${state.nextUpdateTrigger}</p>
    ${state.uncertainties.map((item) => `<p class="warn">확인 필요: ${item}</p>`).join("")}
  `;
}

async function refresh() {
  const response = await fetch("/api/state", { cache: "no-store" });
  const state = await response.json();
  renderState(state);
}

demoButton.addEventListener("click", async () => {
  demoButton.disabled = true;
  demoButton.textContent = "추가 중";
  try {
    await fetch("/api/demo-message", { method: "POST" });
    await refresh();
  } finally {
    demoButton.disabled = false;
    demoButton.textContent = "새 카톡 문장 추가";
  }
});

refresh();
setInterval(refresh, 5000);
