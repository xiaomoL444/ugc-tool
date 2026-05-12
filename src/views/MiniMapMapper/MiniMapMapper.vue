<template>
  <div class="page">
    <header class="hero">
      <div>
        <div class="eyebrow">游戏地图比例换算</div>
        <h1>小地图与场景距离映射计算器</h1>
        <p class="subtitle">
          输入两个场景坐标点的 X / Z 值，再填入这两个点在小地图上的像素距离，即可得到“小地图每 10 像素对应多少场景单位”。
        </p>
      </div>
      <div class="quick-formula">
        <strong>计算逻辑</strong>
        先计算两个场景点的直线距离，再除以小地图像素距离，最后乘以 10。
      </div>
    </header>

    <main class="workspace">
      <section class="card form-card">
        <div class="section-title">
          <h2>填写信息</h2>
          <span>大输入框 · 自动校验</span>
        </div>

        <div class="step-list">
          <article class="step">
            <div class="step-index">A</div>
            <div>
              <h3>原点</h3>
              <p>填写原点对应的预设点在场景中的坐标，只需要 X 轴和 Z 轴。</p>
              <div class="input-grid">
                <div class="field">
                  <label for="x1">X 坐标 <small>原点</small></label>
                  <input id="x1" v-model="form.x1" type="number" step="any" placeholder="例如 120.5" inputmode="decimal" />
                </div>
                <div class="field">
                  <label for="z1">Z 坐标 <small>原点</small></label>
                  <input id="z1" v-model="form.z1" type="number" step="any" placeholder="例如 85" inputmode="decimal" />
                </div>
              </div>
            </div>
          </article>

          <article class="step">
            <div class="step-index">B</div>
            <div>
              <h3>方向点</h3>
              <p>填写方向点对应的预设点在场景中的坐标，只需要 X 轴和 Z 轴。建议选择原点稍远的点，结果会更稳定。</p>
              <div class="input-grid">
                <div class="field">
                  <label for="x2">X 坐标 <small>方向点</small></label>
                  <input id="x2" v-model="form.x2" type="number" step="any" placeholder="例如 250" inputmode="decimal" />
                </div>
                <div class="field">
                  <label for="z2">Z 坐标 <small>方向点</small></label>
                  <input id="z2" v-model="form.z2" type="number" step="any" placeholder="例如 180.2" inputmode="decimal" />
                </div>
              </div>
            </div>
          </article>

          <article class="step">
            <div class="step-index">PX</div>
            <div>
              <h3>小地图像素距离</h3>
              <p>填写原点和方向点在小地图截图上的直线像素距离。</p>
              <div class="input-grid single">
                <div class="field">
                  <label for="pixelDistance">像素距离 <small>Pixel Distance</small></label>
                  <input
                    id="pixelDistance"
                    v-model="form.pixelDistance"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="例如 52"
                    inputmode="decimal"
                  />
                </div>
              </div>
              <div class="tip">提示：像素距离越大，误差通常越小。在小地图界面控件配置中可以看到具体数值。</div>
            </div>
          </article>
        </div>

        <div class="actions">
          <button class="primary" type="button" @click="calculateScale">计算每 10 像素距离</button>
          <button class="secondary" type="button" @click="resetForm">清空</button>
        </div>

        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
      </section>

      <aside class="card result-card">
        <div class="section-title">
          <h2>计算结果</h2>
          <span>实时汇总</span>
        </div>

        <div v-if="!result" class="result-empty">
          <div>
            <div class="icon">↔</div>
            <strong>等待输入并计算</strong><br />
            结果会显示在这里，包括每 10 像素对应的场景距离、每 1 像素对应距离，以及完整计算过程。
          </div>
        </div>

        <div v-else class="result-content">
          <div class="answer-box">
            <div class="answer-label">每 10 像素对应场景距离</div>
            <div class="answer-value">{{ result.distancePer10PixelsText }} 场景单位</div>
            <div class="copy-row">
              <div class="copy-text">{{ copyHint }}</div>
              <button class="copy-button" type="button" @click="copyResult">复制数值</button>
            </div>
          </div>

          <div class="stat-grid">
            <div class="stat">
              <div class="stat-label">场景直线距离</div>
              <div class="stat-value">{{ result.sceneDistanceText }} 场景单位</div>
            </div>
            <div class="stat">
              <div class="stat-label">小地图像素距离</div>
              <div class="stat-value">{{ result.pixelDistanceText }} px</div>
            </div>
            <div class="stat">
              <div class="stat-label">每 1 像素对应</div>
              <div class="stat-value">{{ result.distancePerPixelText }} 场景单位</div>
            </div>
            <div class="stat">
              <div class="stat-label">坐标差值 ΔX / ΔZ</div>
              <div class="stat-value">{{ result.deltaXText }} / {{ result.deltaZText }}</div>
            </div>
          </div>

          <div class="formula-box">
            <strong>计算过程</strong>
            ΔX = X₂ - X₁ = {{ result.x2Text }} - {{ result.x1Text }} = {{ result.deltaXText }}<br />
            ΔZ = Z₂ - Z₁ = {{ result.z2Text }} - {{ result.z1Text }} = {{ result.deltaZText }}<br />
            场景距离 = √(ΔX² + ΔZ²) = {{ result.sceneDistanceText }}<br />
            每 10 像素对应距离 = 场景距离 ÷ 像素距离 × 10 = {{ result.sceneDistanceText }} ÷ {{ result.pixelDistanceText }} × 10 = {{ result.distancePer10PixelsText }}
          </div>
        </div>
      </aside>
    </main>
  </div>
</template>

<script setup>
import { reactive, ref } from "vue";

const form = reactive({
  x1: "",
  z1: "",
  x2: "",
  z2: "",
  pixelDistance: "",
});

const result = ref(null);
const errorMessage = ref("");
const copyHint = ref("计算后可一键复制结果数值。");

function getNumber(value) {
  const trimmedValue = String(value).trim();
  return trimmedValue === "" ? NaN : Number(trimmedValue);
}

function formatNumber(value, digits = 4) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "-";
  return numberValue.toFixed(digits);
}

function showError(message) {
  errorMessage.value = message;
}

function hideError() {
  errorMessage.value = "";
}

function calculateScale() {
  const x1 = getNumber(form.x1);
  const z1 = getNumber(form.z1);
  const x2 = getNumber(form.x2);
  const z2 = getNumber(form.z2);
  const pixelDistance = getNumber(form.pixelDistance);

  if ([x1, z1, x2, z2, pixelDistance].some((value) => Number.isNaN(value))) {
    showError("请完整填写原点、方向点的 X / Z 坐标，以及小地图像素距离。");
    return;
  }

  if (pixelDistance <= 0) {
    showError("小地图像素距离必须大于 0。");
    return;
  }

  const deltaX = x2 - x1;
  const deltaZ = z2 - z1;
  const sceneDistance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);

  if (sceneDistance === 0) {
    showError("原点和方向点不能是同一个场景坐标，否则无法计算映射比例。");
    return;
  }

  const distancePerPixel = sceneDistance / pixelDistance;
  const distancePer10Pixels = distancePerPixel * 10;

  hideError();

  result.value = {
    x1Text: formatNumber(x1),
    z1Text: formatNumber(z1),
    x2Text: formatNumber(x2),
    z2Text: formatNumber(z2),
    deltaXText: formatNumber(deltaX),
    deltaZText: formatNumber(deltaZ),
    sceneDistanceText: formatNumber(sceneDistance),
    pixelDistanceText: formatNumber(pixelDistance),
    distancePerPixelText: formatNumber(distancePerPixel),
    distancePer10PixelsText: formatNumber(distancePer10Pixels, 2),
  };

  copyHint.value = `复制按钮将只复制：${result.value.distancePer10PixelsText}`;
}

async function copyResult() {
  if (!result.value) return;

  const valueToCopy = result.value.distancePer10PixelsText;

  try {
    await navigator.clipboard.writeText(valueToCopy);
    copyHint.value = `已复制数值：${valueToCopy}`;

    window.setTimeout(() => {
      if (result.value) {
        copyHint.value = `复制按钮将只复制：${result.value.distancePer10PixelsText}`;
      }
    }, 1500);
  } catch (error) {
    showError("复制失败，请手动选中结果数值复制。");
  }
}

function resetForm() {
  form.x1 = "";
  form.z1 = "";
  form.x2 = "";
  form.z2 = "";
  form.pixelDistance = "";

  result.value = null;
  copyHint.value = "计算后可一键复制结果数值。";
  hideError();
}
</script>

<style scoped>
* {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  min-height: 100vh;
  font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
  background:
    radial-gradient(circle at top left, rgba(119, 96, 217, 0.22), transparent 34%),
    radial-gradient(circle at top right, rgba(7, 168, 223, 0.20), transparent 32%),
    linear-gradient(180deg, #f7f7fd 0%, #ececf8 45%, #e8e8f6 100%);
  color: #202334;
}

.page {
  --bg: #ececf8;
  --card-soft: #f3f3fb;
  --primary: #07a8df;
  --primary-dark: #087ec7;
  --primary-soft: #e9e8fb;
  --danger-soft: #fff1f4;
  --text: #202334;
  --muted: #656b83;
  --line: #dfe1f1;
  --shadow: 0 18px 45px rgba(63, 75, 124, 0.16);
  --radius: 24px;

  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
  padding: 38px 0 48px;
}

.hero {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  align-items: end;
  margin-bottom: 24px;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 999px;
  color: var(--primary-dark);
  background: var(--primary-soft);
  font-size: 14px;
  font-weight: 800;
}

.eyebrow::before {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--primary);
  content: "";
}

h1 {
  margin: 0 0 10px;
  font-size: clamp(30px, 4vw, 48px);
  line-height: 1.08;
  letter-spacing: -0.04em;
}

.subtitle {
  max-width: 760px;
  margin: 0;
  color: var(--muted);
  font-size: 17px;
  line-height: 1.8;
}

.quick-formula {
  min-width: 260px;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: rgba(247, 247, 253, 0.82);
  box-shadow: 0 12px 32px rgba(63, 75, 124, 0.12);
  backdrop-filter: blur(14px);
  color: #334155;
  font-size: 14px;
  line-height: 1.8;
}

.quick-formula strong {
  display: block;
  margin-bottom: 4px;
  color: var(--text);
  font-size: 15px;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
  gap: 24px;
  align-items: start;
}

.card {
  border: 1px solid rgba(219, 227, 239, 0.95);
  border-radius: var(--radius);
  background: rgba(247, 247, 253, 0.9);
  box-shadow: var(--shadow);
  backdrop-filter: blur(14px);
}

.form-card {
  padding: 28px;
}

.result-card {
  position: sticky;
  top: 24px;
  padding: 24px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.section-title h2 {
  margin: 0;
  font-size: 23px;
  letter-spacing: -0.02em;
}

.section-title span {
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.step-list {
  display: grid;
  gap: 18px;
}

.step {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: var(--card-soft);
}

.step-index {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  color: #ffffff;
  background: linear-gradient(135deg, #7760d9 0%, #238ae1 52%, #05b7e8 100%);
  font-size: 22px;
  font-weight: 900;
  box-shadow: 0 12px 24px rgba(63, 75, 124, 0.22);
}

.step h3 {
  margin: 0 0 6px;
  font-size: 20px;
}

.step p {
  margin: 0 0 16px;
  color: var(--muted);
  line-height: 1.7;
}

.input-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.input-grid.single {
  grid-template-columns: minmax(0, 1fr);
}

.field label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
  color: #374151;
  font-size: 15px;
  font-weight: 900;
}

.field label small {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.field input {
  width: 100%;
  height: 58px;
  border: 2px solid #d8dced;
  border-radius: 16px;
  outline: none;
  padding: 0 16px;
  color: var(--text);
  background: #ffffff;
  font-size: 20px;
  font-weight: 800;
  transition: border-color 0.16s, box-shadow 0.16s, transform 0.16s;
}

.field input::placeholder {
  color: #a7b1c2;
  font-weight: 600;
}

.field input:focus {
  border-color: #07a8df;
  box-shadow: 0 0 0 5px rgba(7, 168, 223, 0.16);
  transform: translateY(-1px);
}

.tip {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  color: #475569;
  background: #ecebfa;
  border: 1px solid #d8d8ef;
  font-size: 14px;
  line-height: 1.65;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 160px;
  gap: 14px;
  margin-top: 22px;
}

button {
  height: 58px;
  border: 0;
  border-radius: 17px;
  cursor: pointer;
  font-size: 18px;
  font-weight: 900;
  transition: transform 0.16s, box-shadow 0.16s, filter 0.16s;
}

button:hover {
  transform: translateY(-2px);
}

button:active {
  transform: translateY(0);
}

.primary {
  color: #ffffff;
  background: linear-gradient(135deg, #7760d9 0%, #238ae1 52%, #05b7e8 100%);
  box-shadow: 0 16px 28px rgba(63, 75, 124, 0.24);
}

.secondary {
  color: #334155;
  background: #e8e8f6;
  border: 1px solid #d8d8ef;
}

.error {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 16px;
  color: #991b1b;
  background: var(--danger-soft);
  border: 1px solid #fecdd3;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.6;
}

.result-empty {
  min-height: 410px;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 28px;
  border-radius: 20px;
  background: linear-gradient(180deg, #f7f7fd, #eeeefa);
  border: 1px dashed #cbd0e5;
  color: var(--muted);
  line-height: 1.8;
}

.result-empty .icon {
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
  margin: 0 auto 14px;
  border-radius: 24px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 36px;
  font-weight: 900;
}

.answer-box {
  padding: 22px;
  border-radius: 22px;
  color: #ffffff;
  background: linear-gradient(135deg, #7760d9 0%, #238ae1 52%, #05b7e8 100%);
  box-shadow: 0 18px 35px rgba(63, 75, 124, 0.24);
  margin-bottom: 18px;
}

.answer-label {
  margin-bottom: 8px;
  font-size: 15px;
  font-weight: 800;
  opacity: 0.9;
}

.answer-value {
  font-size: clamp(34px, 5vw, 52px);
  line-height: 1.08;
  font-weight: 950;
  letter-spacing: -0.04em;
  word-break: break-word;
}

.copy-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
  margin-top: 16px;
}

.copy-text {
  padding: 11px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  line-height: 1.5;
}

.copy-button {
  height: 42px;
  padding: 0 14px;
  border-radius: 13px;
  color: #0f172a;
  background: #ffffff;
  font-size: 14px;
  box-shadow: none;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.stat {
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: #f7f7fd;
}

.stat-label {
  margin-bottom: 6px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 800;
}

.stat-value {
  color: var(--text);
  font-size: 20px;
  font-weight: 950;
  word-break: break-word;
}

.formula-box {
  padding: 18px;
  border-radius: 18px;
  background: #f3f3fb;
  border: 1px solid var(--line);
  color: #334155;
  font-size: 15px;
  line-height: 1.9;
}

.formula-box strong {
  display: block;
  margin-bottom: 8px;
  color: var(--text);
  font-size: 17px;
}

@media (max-width: 960px) {
  .hero,
  .workspace {
    grid-template-columns: 1fr;
  }

  .quick-formula {
    min-width: 0;
  }

  .result-card {
    position: static;
  }
}

@media (max-width: 680px) {
  .page {
    width: min(100% - 20px, 1180px);
    padding-top: 22px;
  }

  .form-card,
  .result-card {
    padding: 18px;
  }

  .step {
    grid-template-columns: 1fr;
  }

  .input-grid,
  .stat-grid,
  .actions,
  .copy-row {
    grid-template-columns: 1fr;
  }

  .field input,
  button {
    height: 56px;
  }
}
</style>
