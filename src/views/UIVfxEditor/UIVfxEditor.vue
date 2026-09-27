<template>
  <div class="particle-editor" @keydown.esc="libraryOpen = false; exportOpen = false">
    <header class="editor-toolbar">
      <button class="workspace-button" aria-label="管理工作区和编辑文件" :disabled="!archive" @click="workspacePanelOpen = true"><EditorIcon name="folder" :size="17" /><span>工作区与文件</span></button>
      <button class="current-file" aria-label="切换工作区或文件" :disabled="!archive" @click="workspacePanelOpen = true"><strong :title="archive?.selectedWorkspace.value">{{ archive?.selectedWorkspace.value || "UI 粒子工坊" }}</strong><span :title="project.name">{{ hasOpenDocument ? project.name : "未打开编辑文件" }}</span></button>
      <button class="quiet-button new-file-button" :disabled="archiveBusy || !archive?.ready.value || !archive?.selectedWorkspace.value" @click="requestArchiveAction('createDocument')"><EditorIcon name="plus" :size="14" />新建文件</button>
      <div class="toolbar-spacer" />
      <button class="save-state" :class="{ warning: validationError || archive?.error.value || storageError }" @click="workspacePanelOpen = true">{{ validationError ? "参数待修正" : archive?.status.value || storageError || "本地自动保存" }}</button>
      <button class="quiet-button" :disabled="editingBlocked || !previousProject" @click="undoReplace">撤回替换</button>
      <button class="quiet-button" :disabled="archiveBusy || (!!archive && !archive.ready.value)" @click="openImport">导入</button>
      <button class="quiet-button" :disabled="editingBlocked" @click="saveCurrentDocument">保存</button>
      <button class="quiet-button" :disabled="editingBlocked" @click="exportProject">导出 JSON</button>
      <button class="primary-button" :disabled="editingBlocked" @click="exportOpen = true">导出 Lua ↗</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importProject" />
    </header>
    <div v-if="notice || validationError" class="notice" :class="{ error: validationError || noticeError }" role="status">
      <span>{{ validationError || notice }}</span><button v-if="!validationError" aria-label="关闭提示" @click="notice = ''">×</button>
    </div>
    <main class="editor-layout">
      <aside class="left-panel" :inert="editingBlocked">
        <div class="panel-heading"><span>效果工程</span><span class="eyebrow">PROJECT</span></div>
        <div class="text-field project-name"><span>工程名称 <button v-if="archive" class="text-button" @click="requestArchiveAction('renameDocument')">重命名</button></span><input v-model="project.name" :readonly="!!archive" maxlength="100" aria-label="工程名称" /></div>
        <div class="pair project-size"><ParticleNumber v-model="project.width" label="画布宽度" :min="320" :max="3840" /><ParticleNumber v-model="project.height" label="画布高度" :min="240" :max="2160" /></div>
        <div class="section-label">从一个效果开始</div>
        <div class="presets">
          <button v-for="preset in presets" :key="preset.id" class="preset-card" :class="preset.id" @click="usePreset(preset.id)">
            <span class="preset-art">{{ preset.icon }}</span><span><strong>{{ preset.name }}</strong><small>{{ preset.description }}</small></span><span class="preset-arrow">↗</span>
          </button>
        </div>
        <div class="panel-heading emitter-heading"><span>发射器 <small>{{ project.emitters.length }}/8</small></span><button aria-label="添加发射器" :disabled="!canAdd" @click="addEmitter">＋</button></div>
        <div class="emitter-list">
          <div v-for="(emitter, index) in project.emitters" :key="emitter.id" class="emitter-row" :class="{ selected: emitter.id === selectedId, muted: !emitter.enabled }">
            <input v-model="emitter.enabled" type="checkbox" :aria-label="'启用 ' + emitter.name" />
            <button class="emitter-select" @click="selectedId = emitter.id"><span class="layer-number">{{ String(index + 1).padStart(2, '0') }}</span><span>{{ emitter.name }}</span></button>
            <span class="emitter-dot" :style="{ background: colorCss(emitter.startColor) }" />
          </div>
        </div>
        <div class="layer-actions"><button :disabled="!canAdd" @click="duplicateEmitter">复制</button><button :disabled="selectedIndex <= 0" aria-label="发射器上移" @click="moveEmitter(-1)">↑</button><button :disabled="selectedIndex >= project.emitters.length - 1" aria-label="发射器下移" @click="moveEmitter(1)">↓</button><button :disabled="project.emitters.length === 1" @click="deleteEmitter">删除</button></div>
        <div class="budget-card"><div><span class="live-dot" />实时粒子 <strong>{{ liveCount }}</strong></div><div class="budget-track"><i :style="{ width: Math.min(100, budget / MAX_CONTROLS * 100) + '%' }" /></div><small>控件预算 {{ budget }} / {{ MAX_CONTROLS }}</small><p>每个粒子对应一个 UI 图片控件。满池时，新粒子复用最早的槽位。</p></div>
        <div class="left-footer">✧ 固定种子 · 可重复预览</div>
      </aside>
      <section class="workspace" :inert="editingBlocked">
        <div class="stage-toolbar">
          <div class="stage-title"><span class="live-dot" /><strong>实时预览</strong><span>{{ project.width }} × {{ project.height }}</span></div>
          <div class="stage-options"><label><input v-model="showGrid" type="checkbox" />网格</label><label><input v-model="showGuides" type="checkbox" />辅助线</label><button :class="{ active: lightBackground }" aria-label="切换预览背景" @click="lightBackground = !lightBackground">◐</button></div>
        </div>
        <div class="stage-area" :class="{ light: lightBackground }">
          <div class="stage-caption"><span>UI CANVAS</span><span>中心原点 · Y 向上</span></div>
          <div class="canvas-holder">
            <svg ref="stage" class="particle-stage" :viewBox="[-project.width / 2, -project.height / 2, project.width, project.height].join(' ')" aria-label="粒子预览画布" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragEnd">
              <defs><pattern id="ui-particle-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" stroke-width=".6" /></pattern></defs>
              <rect class="canvas-background" :x="-project.width / 2" :y="-project.height / 2" :width="project.width" :height="project.height" />
              <rect v-if="showGrid" class="grid-fill" :x="-project.width / 2" :y="-project.height / 2" :width="project.width" :height="project.height" fill="url(#ui-particle-grid)" />
              <g v-if="showGuides" class="axes"><path :d="'M '+(-project.width/2)+' 0 H '+project.width/2+' M 0 '+(-project.height/2)+' V '+project.height/2" /></g>
              <g v-for="layer in layers" :key="layer.emitter.id" class="particle-layer" pointer-events="none">
                <g v-for="p in layer.frames" :key="p.slot" :transform="'translate('+p.x+','+(-p.y)+') rotate('+(-p.rotation)+')'">
                  <svg v-if="layer.asset?.src && !layer.asset.missing && p.size > 0" :x="-p.size/2" :y="-p.size/2" :width="p.size" :height="p.size" overflow="visible"><SpriteImage :asset="layer.asset" :width="p.size" :height="p.size" image-type="basic" :color="p.color" /></svg>
                  <circle v-else :r="Math.max(0, p.size / 2)" :fill="colorCss(p.color)" />
                </g>
              </g>
              <g v-if="showGuides" class="emitter-guides" :transform="'translate('+selected.origin.x+','+(-selected.origin.y)+')'">
                <circle v-if="selected.shape === 'circle' || selected.shape === 'ring'" class="shape-guide" :r="selected.radius" />
                <rect v-if="selected.shape === 'box'" class="shape-guide" :x="-selected.width/2" :y="-selected.height/2" :width="selected.width" :height="selected.height" />
                <template v-if="selected.motion === 'bezier'">
                  <path class="control-line" :d="'M 0 0 L '+selected.control1.x+' '+(-selected.control1.y)+' M '+selected.control2.x+' '+(-selected.control2.y)+' L '+selected.target.x+' '+(-selected.target.y)" />
                  <path class="bezier-guide" :d="'M 0 0 C '+selected.control1.x+' '+(-selected.control1.y)+','+selected.control2.x+' '+(-selected.control2.y)+','+selected.target.x+' '+(-selected.target.y)" />
                  <g v-for="handle in pathHandles" :key="handle.key" class="drag-handle" :transform="'translate('+selected[handle.key].x+','+(-selected[handle.key].y)+')'" @pointerdown.stop.prevent="dragStart($event, handle.key)"><circle r="9" /><text x="14" y="-12">{{ handle.label }}</text></g>
                </template>
                <g class="origin-handle" @pointerdown.stop.prevent="dragStart($event, 'origin')"><circle r="12" /><path d="M -19 0 H 19 M 0 -19 V 19" /><text x="22" y="5">发射点</text></g>
              </g>
            </svg>
          </div>
          <div class="stage-footnote"><span>{{ showGuides ? (selected.motion === 'bezier' ? "拖动发射点、P1、P2 或终点调整路径" : "拖动十字移动发射器") : "辅助线已隐藏" }}</span><span v-if="placeholderCount" class="asset-warning">{{ placeholderCount }} 个图层使用示意圆点</span><span v-else>普通透明混合</span></div>
        </div>
        <div class="transport">
          <div class="transport-top"><button class="restart-button" aria-label="从头播放" @click="restart">↺</button><button class="play-button" :aria-label="playing ? '暂停预览' : '播放预览'" @click="togglePlay">{{ playing ? "Ⅱ" : "▶" }}</button><span class="time-display"><strong>{{ time.toFixed(2) }}</strong><span>/ {{ project.previewDuration.toFixed(1) }} s</span></span><div class="transport-spacer" /><label class="loop-preview"><input v-model="previewLoop" type="checkbox" />循环预览</label><select v-model.number="playbackSpeed" aria-label="预览速度"><option :value=".25">0.25 ×</option><option :value=".5">0.5 ×</option><option :value="1">1 ×</option><option :value="2">2 ×</option></select></div>
          <input class="timeline" type="range" min="0" :max="project.previewDuration" step=".001" :value="time" aria-label="预览时间" @input="scrub" />
          <div class="timeline-ticks"><span v-for="tick in 7" :key="tick">{{ ((tick - 1) * project.previewDuration / 6).toFixed(1) }}s</span></div>
          <div class="transport-bottom"><span>空格 播放 / 暂停</span><ParticleNumber v-model="project.previewDuration" label="预览时长" :min=".1" :max="120" :step=".1" unit="s" /></div>
        </div>
      </section>
      <aside class="inspector" :inert="editingBlocked">
        <div class="panel-heading"><span>发射器属性</span><span class="eyebrow">INSPECTOR</span></div>
        <div class="inspector-scroll" :key="selected.id">
          <label class="text-field"><span>名称</span><input v-model="selected.name" maxlength="100" aria-label="发射器名称" /></label>
          <div class="image-card"><button class="image-preview" aria-label="选择粒子图片" @click="libraryOpen = true"><SpriteImage v-if="selectedAsset?.src && !selectedAsset.missing" :asset="selectedAsset" :width="54" :height="54" image-type="basic" :color="white" /><span v-else>✧</span></button><div><strong>粒子图片</strong><small>{{ selected.imageId === null ? "尚未选择资源" : "#" + selected.imageId }}</small><button class="text-button" @click="libraryOpen = true">打开图片库 ↗</button></div></div>
          <p v-if="imageCatalogError" class="field-warning">{{ imageCatalogError }}<button class="text-button" @click="loadImageCatalog(true)">重试</button></p>
          <details open><summary><span>01</span>发射</summary>
            <div class="pair"><ParticleNumber v-model="selected.duration" label="发射周期" :min=".1" :max="60" :step=".1" unit="s" /><ParticleNumber v-model="selected.delay" label="启动延迟" :min="0" :max="60" :step=".1" unit="s" /></div>
            <label class="check-field"><input v-model="selected.loop" type="checkbox" />循环发射</label>
            <div class="pair"><ParticleNumber v-model="selected.rate" label="每秒发射" :min="0" :max="200" :step=".1" unit="个" /><ParticleNumber v-model="selected.burst" label="周期起点爆发" :min="0" :max="512" unit="个" /></div>
            <div class="pair"><ParticleNumber v-model="selected.maxParticles" label="粒子池上限" :min="1" :max="selectedBudget" /><ParticleNumber v-model="selected.seed" label="随机种子" :min="1" :max="2147483646" /></div>
          </details>
          <details open><summary><span>02</span>出生形状</summary>
            <div class="segmented"><button v-for="shape in shapes" :key="shape.value" :class="{ active: selected.shape === shape.value }" @click="selected.shape = shape.value">{{ shape.label }}</button></div>
            <div class="pair"><ParticleNumber v-model="selected.origin.x" label="位置 X" /><ParticleNumber v-model="selected.origin.y" label="位置 Y" /></div>
            <ParticleNumber v-if="selected.shape === 'circle' || selected.shape === 'ring'" v-model="selected.radius" label="半径" :min="0" :max="2000" unit="px" />
            <div v-if="selected.shape === 'box'" class="pair"><ParticleNumber v-model="selected.width" label="区域宽度" :min="0" :max="4000" /><ParticleNumber v-model="selected.height" label="区域高度" :min="0" :max="4000" /></div>
          </details>
          <details open><summary><span>03</span>初始属性 <small>随机范围</small></summary>
            <div v-for="field in visibleRanges" :key="field.key" class="range-row"><span>{{ field.label }} <small>{{ field.unit }}</small></span><div class="pair"><ParticleNumber :model-value="selected[field.key].min" :label="field.label + '最小值'" :min="field.min" :max="selected[field.key].max" :step="field.step" @update:model-value="selected[field.key].min = $event" /><ParticleNumber :model-value="selected[field.key].max" :label="field.label + '最大值'" :min="selected[field.key].min" :max="field.max" :step="field.step" @update:model-value="selected[field.key].max = $event" /></div></div>
          </details>
          <details open><summary><span>04</span>运动</summary>
            <div class="segmented"><button :class="{ active: selected.motion === 'velocity' }" @click="selected.motion = 'velocity'">速度 + 加速度</button><button :class="{ active: selected.motion === 'bezier' }" @click="selected.motion = 'bezier'">贝塞尔路径</button></div>
            <template v-if="selected.motion === 'velocity'"><div class="pair"><ParticleNumber v-model="selected.angle" label="方向角" :min="-360" :max="360" unit="°" /><ParticleNumber v-model="selected.spread" label="散射角" :min="0" :max="360" unit="°" /></div><div class="pair"><ParticleNumber v-model="selected.gravity.x" label="加速度 X" unit="px/s²" /><ParticleNumber v-model="selected.gravity.y" label="加速度 Y" unit="px/s²" /></div><p class="hint">0° 向右，90° 向上。负 Y 加速度模拟重力。</p></template>
            <template v-else><div v-for="handle in pathHandles" :key="handle.key" class="pair"><ParticleNumber v-model="selected[handle.key].x" :label="handle.label + ' X'" /><ParticleNumber v-model="selected[handle.key].y" :label="handle.label + ' Y'" /></div><p class="hint">坐标相对发射点；用函数计算三次贝塞尔。沿路径的进度由寿命决定。</p></template>
          </details>
          <details open><summary><span>05</span>生命周期</summary>
            <ParticleCurve v-model="selected.sizeCurve" label="大小倍率" :max="3" /><ParticleCurve v-model="selected.alphaCurve" label="透明度" :max="1" />
            <ColorRGBAField v-model="selected.startColor" label="出生颜色" /><ColorRGBAField v-model="selected.endColor" label="结束颜色" />
            <p class="hint">横轴为寿命进度 0 → 1；双击曲线添加关键点，拖动调整。颜色在两端之间渐变。</p>
          </details>
        </div>
      </aside>
      <div v-if="editingBlocked" class="archive-empty">
        <EditorIcon name="folder" :size="32" /><strong>{{ archiveBusy ? "正在处理存档…" : !archive?.ready.value ? "正在读取工作区…" : "未打开特效文件" }}</strong>
        <p>{{ archive?.error.value || (archive?.ready.value ? "从工作区打开一个文件，或新建一个粒子特效。" : "工作区就绪后即可继续编辑。") }}</p>
        <button :disabled="archiveBusy" @click="workspacePanelOpen = true">打开工作区</button>
      </div>
    </main>
    <ClientUIWorkspacePanel v-if="archive" kind="particles" :open="workspacePanelOpen" :busy="archiveBusy"
      :workspaces="archive.workspaceIds.value" :documents="archive.documentNames.value"
      :workspace="archive.selectedWorkspace.value" :document="archive.selectedDocument.value"
      :status="archive.status.value" :error="archive.error.value"
      @close="workspacePanelOpen = false" @select-workspace="switchWorkspace" @select-document="switchDocument"
      @create-workspace="requestArchiveAction('createWorkspace')" @rename-workspace="requestArchiveAction('renameWorkspace')" @delete-workspace="requestArchiveAction('deleteWorkspace')"
      @create-document="requestArchiveAction('createDocument')" @rename-document="requestArchiveAction('renameDocument')" @delete-document="requestArchiveAction('deleteDocument')"
      @import-json="openImport" @retry="initializeOrSave" />
    <ClientUIArchiveActionDialog v-if="archiveAction" :title="archiveAction.title" :message="archiveAction.message" :mode="archiveAction.mode"
      :initial-value="archiveAction.initialValue" :busy="archiveBusy" :error="archive?.error.value || ''" @cancel="archiveAction = null" @submit="confirmArchiveAction" />
    <button v-if="archive?.canUndoDelete.value && !workspacePanelOpen && !archiveAction" class="archive-undo" :disabled="archiveBusy" @click="runArchiveAction(() => archive!.undoDelete())">已移至回收站 · 撤销删除</button>
    <ImageAssetLibrary v-if="libraryOpen" :selected-id="selected.imageId" :load-metadata="false" @select="selectImage" @close="libraryOpen = false" />
    <div v-if="exportOpen" class="modal-backdrop" @click.self="exportOpen = false">
      <section class="export-dialog" role="dialog" aria-modal="true" aria-label="导出千星 UI 粒子">
        <div class="modal-heading"><div><span class="eyebrow">EXPORT TO MILIASTRA</span><h2>把效果带进千星</h2></div><button aria-label="关闭导出" @click="exportOpen = false">×</button></div>
        <p>导出一个 Lua 脚本、工程 JSON 和接入说明。将脚本挂在容器上，通过图片控件模板创建粒子。</p>
        <label class="text-field"><span>图片控件模板索引 <small>可留空，接入时填写</small></span><input v-model="templateInput" type="number" min="0" step="1" placeholder="在千星工程中创建的图片模板索引" aria-label="图片控件模板索引" /></label>
        <label class="check-field"><input v-model="levelTime" type="checkbox" />跟随关卡时间（OnLevelUpdate）</label>
        <div class="export-facts"><div><small>启用发射器</small><strong>{{ project.emitters.filter(e => e.enabled).length }}</strong></div><div><small>预创建图片控件</small><strong>{{ activeBudget }}</strong></div><div><small>曲线计算</small><strong>Lua 函数</strong></div></div>
        <p class="hint">模板索引与图片资源 ID 是两个不同的值。留空时，导出文件中的索引为 nil，需要填写后运行。网页预览时长不会限制游戏内播放。</p>
        <p v-if="exportProblem" class="field-warning" role="alert">{{ exportProblem }}</p>
        <details class="lua-preview"><summary>查看导出 Lua</summary><pre>{{ exportProblem || luaCode }}</pre></details>
        <p class="export-note">此版本未在千星内实机验证；请按接入说明检查回调、模板和设备性能。</p>
        <div class="modal-actions"><button @click="exportOpen = false">返回编辑</button><button :disabled="!!exportProblem" @click="downloadLua">仅 Lua</button><button class="primary-button" :disabled="!!exportProblem || exporting" @click="downloadBundle">{{ exporting ? "正在打包…" : "下载接入包 ZIP ↗" }}</button></div>
      </section>
    </div>
  </div>
</template>


<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import type { StorageClass } from "../../services/storage/storage";
import EditorIcon from "../ClientUIAnimationEditor/EditorIcon.vue";
import ClientUIWorkspacePanel from "../ClientUIAnimationEditor/ClientUIWorkspacePanel.vue";
import ClientUIArchiveActionDialog from "../ClientUIAnimationEditor/ClientUIArchiveActionDialog.vue";
import { ClientUIWorkspaceRepository } from "../ClientUIAnimationEditor/workspaceStorage";
import { useClientUIWorkspace } from "../ClientUIAnimationEditor/useClientUIWorkspace";
import { PARTICLE_PROJECT_ID, LEGACY_PARTICLE_KEY, migrateParticleLegacy, particleDocumentName } from "./particleWorkspace";
import JSZip from "jszip";
import ImageAssetLibrary from "../ClientUIAnimationEditor/ImageAssetLibrary.vue";
import SpriteImage from "../ClientUIAnimationEditor/SpriteImage.vue";
import ColorRGBAField from "../ClientUIAnimationEditor/ColorRGBAField.vue";
import { imageAssetById, loadImageCatalog, imageCatalogError } from "../ClientUIAnimationEditor/imageAssets";
import type { ColorRGBA } from "../ClientUIAnimationEditor/types";
import ParticleNumber from "./ParticleNumber.vue";
import ParticleCurve from "./ParticleCurve.vue";
import { MAX_CONTROLS, copyProject, createEmitter, createPreset, newEmitterId, parseProject, type ParticleProject, type ParticleEmitter, type PresetName, type Point } from "./particleModel";
import { sampleEmitter } from "./particleSimulation";
import { buildParticleLua, buildHandoff } from "./particleLuaExporter";

const STORAGE_KEY = LEGACY_PARTICLE_KEY;
let legacyProject: string | null = null;
const notice = ref(""), noticeError = ref(false), storageError = ref("");
let initial = createPreset("stars", 100002);
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) { initial = parseProject(JSON.parse(stored)); legacyProject = stored; }
} catch { notice.value = "本地工程无法读取，已打开默认效果。可以导入之前保存的 JSON。"; noticeError.value = true; }
const project = ref<ParticleProject>(initial);
const sharedStorage = inject<StorageClass | null>("storage", null);
const workspacePanelOpen = ref(false), initializingArchive = ref(false);
const repository = sharedStorage ? new ClientUIWorkspaceRepository(sharedStorage, PARTICLE_PROJECT_ID) : null;
const archive = repository ? useClientUIWorkspace(repository, {
  capture: () => JSON.stringify(parseProject(project.value)),
  apply: applyWorkspaceProject,
  createBlank: name => { const data = createPreset("stars", 100002); data.name = name; return JSON.stringify(data); },
  initialDocumentName: "新建特效",
  onBeforeSwitch: stopDocumentInteraction,
}) : null;
const hasOpenDocument = computed(() => !archive || Boolean(archive.ready.value && archive.selectedDocument.value));
const archiveBusy = computed(() => initializingArchive.value || Boolean(archive?.busy.value));
const editingBlocked = computed(() => archiveBusy.value || !hasOpenDocument.value);
type ArchiveActionKind = "createWorkspace" | "renameWorkspace" | "deleteWorkspace" | "createDocument" | "renameDocument" | "deleteDocument";
const archiveAction = ref<{ kind: ArchiveActionKind; title: string; message: string; mode: "name" | "confirm"; initialValue: string } | null>(null);
const selectedId = ref(initial.emitters[0].id);
const selectedIndex = computed(() => Math.max(0, project.value.emitters.findIndex(e => e.id === selectedId.value)));
const selected = computed(() => project.value.emitters[selectedIndex.value]);
const selectedAsset = computed(() => imageAssetById.get(selected.value.imageId ?? -1) ?? null);
const budget = computed(() => project.value.emitters.reduce((n, e) => n + e.maxParticles, 0));
const activeBudget = computed(() => project.value.emitters.reduce((n, e) => n + (e.enabled ? e.maxParticles : 0), 0));
const selectedBudget = computed(() => Math.min(512, MAX_CONTROLS - budget.value + selected.value.maxParticles));
const canAdd = computed(() => project.value.emitters.length < 8 && budget.value < MAX_CONTROLS);
const validationError = computed(() => { try { parseProject(project.value); return ""; } catch (error) { return String((error as Error).message); } });
const previousProject = ref<ParticleProject | null>(null);
const time = ref(0), playing = ref(true), previewLoop = ref(true), playbackSpeed = ref(1);
const showGrid = ref(true), showGuides = ref(true), lightBackground = ref(false), libraryOpen = ref(false);
const stage = ref<SVGSVGElement>(), fileInput = ref<HTMLInputElement>();
const white: ColorRGBA = { r: 255, g: 255, b: 255, a: 1 };
const colorCss = (c: ColorRGBA) => "rgba(" + c.r + "," + c.g + "," + c.b + "," + c.a + ")";
const layers = computed(() => project.value.emitters.filter(e => e.enabled).map(emitter => ({
  emitter, asset: imageAssetById.get(emitter.imageId ?? -1) ?? null,
  frames: sampleEmitter(emitter, time.value).sort((a, b) => a.slot - b.slot),
})));
const liveCount = computed(() => layers.value.reduce((n, layer) => n + layer.frames.length, 0));
const placeholderCount = computed(() => layers.value.filter(layer => !layer.asset?.src || layer.asset.missing).length);
const presets: { id: PresetName; name: string; description: string; icon: string }[] = [
  { id: "stars", name: "星光散射", description: "爆发 · 渐隐 · 重力", icon: "✦" },
  { id: "snow", name: "轻雪飘落", description: "矩形区域 · 持续发射", icon: "❄" },
  { id: "coins", name: "金币汇聚", description: "贝塞尔 · 定点收集", icon: "◌" },
];
const shapes: { value: ParticleEmitter["shape"]; label: string }[] = [{ value: "point", label: "点" }, { value: "circle", label: "圆" }, { value: "ring", label: "圆环" }, { value: "box", label: "矩形" }];
const pathHandles: { key: "control1" | "control2" | "target"; label: string }[] = [{ key: "control1", label: "P1" }, { key: "control2", label: "P2" }, { key: "target", label: "终点" }];
const rangeFields: { key: "lifetime" | "size" | "speed" | "rotation" | "spin"; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: "lifetime", label: "寿命", unit: "s", min: .05, max: 30, step: .05 },
  { key: "size", label: "尺寸", unit: "px", min: 1, max: 300, step: 1 },
  { key: "speed", label: "速度", unit: "px/s", min: 0, max: 2000, step: 1 },
  { key: "rotation", label: "初始角度", unit: "°", min: -360, max: 360, step: 1 },
  { key: "spin", label: "角速度", unit: "°/s", min: -720, max: 720, step: 1 },
];
const visibleRanges = computed(() => rangeFields.filter(f => selected.value.motion === "velocity" || f.key !== "speed"));
function tell(message: string, error = false) { notice.value = message; noticeError.value = error; }
function replaceProject(next: ParticleProject) {
  previousProject.value = copyProject(project.value);
  if (archive?.selectedDocument.value) next.name = archive.selectedDocument.value;
  project.value = next; selectedId.value = next.emitters[0].id; time.value = 0; playing.value = true;
}
function undoReplace() {
  if (!previousProject.value) return;
  const previous = previousProject.value;
  if (archive?.selectedDocument.value) previous.name = archive.selectedDocument.value;
  previousProject.value = copyProject(project.value); project.value = previous;
  selectedId.value = previous.emitters[0].id; time.value = 0; tell("已恢复上一个工程状态。");
}
function usePreset(id: PresetName) { replaceProject(createPreset(id, selected.value.imageId ?? 100002)); tell("已载入「" + project.value.name + "」，可用“撤回替换”恢复之前的工程。"); }
function addEmitter() {
  if (!canAdd.value) return;
  const emitter = createEmitter("发射器 " + (project.value.emitters.length + 1));
  emitter.imageId = selected.value.imageId; emitter.seed += project.value.emitters.length * 97;
  emitter.maxParticles = Math.min(emitter.maxParticles, MAX_CONTROLS - budget.value);
  project.value.emitters.push(emitter); selectedId.value = emitter.id;
}
function duplicateEmitter() {
  if (!canAdd.value) return;
  const emitter: ParticleEmitter = JSON.parse(JSON.stringify(selected.value));
  emitter.id = newEmitterId(); emitter.name = (emitter.name + " 副本").slice(0, 100);
  emitter.maxParticles = Math.min(emitter.maxParticles, MAX_CONTROLS - budget.value);
  project.value.emitters.push(emitter); selectedId.value = emitter.id;
}
function deleteEmitter() {
  if (project.value.emitters.length === 1) return;
  previousProject.value = copyProject(project.value);
  project.value.emitters.splice(selectedIndex.value, 1); selectedId.value = project.value.emitters[0].id;
}
function moveEmitter(direction: number) {
  const index = selectedIndex.value, next = index + direction;
  if (next < 0 || next >= project.value.emitters.length) return;
  const emitter = project.value.emitters.splice(index, 1)[0]; project.value.emitters.splice(next, 0, emitter);
}
function selectImage(id: number | null) { selected.value.imageId = id; libraryOpen.value = false; }
function restart() { time.value = 0; playing.value = true; }
function togglePlay() { if (!playing.value && time.value >= project.value.previewDuration) time.value = 0; playing.value = !playing.value; }
function scrub(event: Event) { playing.value = false; time.value = Number((event.target as HTMLInputElement).value); }
watch(() => project.value.previewDuration, duration => { time.value = Math.min(time.value, duration); });
let drag: { key: "origin" | "control1" | "control2" | "target"; id: number; emitter: ParticleEmitter; offset: Point } | null = null;
function stagePoint(event: PointerEvent): Point | null {
  const matrix = stage.value?.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: -point.y };
}
function dragStart(event: PointerEvent, key: "origin" | "control1" | "control2" | "target") {
  const p = stagePoint(event); if (!p) return;
  const e = selected.value, value = e[key];
  const origin = key === "origin" ? { x: 0, y: 0 } : e.origin;
  drag = { key, id: event.pointerId, emitter: e, offset: { x: p.x - value.x - origin.x, y: p.y - value.y - origin.y } };
  stage.value?.setPointerCapture(event.pointerId);
}
function dragMove(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return;
  const p = stagePoint(event); if (!p) return;
  const origin = drag.key === "origin" ? { x: 0, y: 0 } : drag.emitter.origin;
  const clamp = (n: number) => Math.max(-5000, Math.min(5000, Math.round(n)));
  drag.emitter[drag.key] = { x: clamp(p.x - origin.x - drag.offset.x), y: clamp(p.y - origin.y - drag.offset.y) };
}
function dragEnd(event: PointerEvent) { if (drag?.id === event.pointerId) { if (stage.value?.hasPointerCapture(event.pointerId)) stage.value.releasePointerCapture(event.pointerId); drag = null; } }
function filename() { return project.value.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 70) || "UI粒子"; }
function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data), link = document.createElement("a");
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function exportProject() {
  try { const data = parseProject(project.value); download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename() + ".particles.json"); tell("工程已保存，可通过“导入”继续编辑。"); }
  catch (error) { tell((error as Error).message, true); }
}
async function importProject(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("工程文件不能大于 2 MB");
    const imported = parseProject(JSON.parse(await file.text()));
    if (archive) {
      const success = await runArchiveAction(() => archive.createDocument(particleDocumentName(imported.name), JSON.stringify(imported)));
      if (!success) return;
      workspacePanelOpen.value = false; playing.value = true;
    } else replaceProject(imported);
    tell("已导入「" + project.value.name + "」。");
  } catch (error) { tell("导入失败：" + (error as Error).message, true); }
}
const exportOpen = ref(false), templateInput = ref(""), levelTime = ref(false), exporting = ref(false);
const exportOptions = computed(() => ({ templateIndex: String(templateInput.value).trim() === "" ? undefined : Number(templateInput.value), levelTime: levelTime.value }));
const exportProblem = computed(() => {
  try {
    buildParticleLua(project.value, exportOptions.value);
    const missing = project.value.emitters.find(e => e.enabled && (!imageAssetById.get(e.imageId ?? -1)?.src || imageAssetById.get(e.imageId ?? -1)?.missing));
    return missing ? "「" + missing.name + "」的图片尚未就绪，请在图片库选择可用资源。" : "";
  } catch (error) { return (error as Error).message; }
});
const luaCode = computed(() => { try { return buildParticleLua(project.value, exportOptions.value); } catch { return ""; } });
function downloadLua() {
  if (exportProblem.value) return;
  download(new Blob([luaCode.value], { type: "text/plain;charset=utf-8" }), filename() + ".lua");
}
async function downloadBundle() {
  if (exportProblem.value || exporting.value) return;
  exporting.value = true;
  try {
    const zip = new JSZip();
    zip.file("ParticleEffect.lua", luaCode.value);
    zip.file("project.json", JSON.stringify(parseProject(project.value), null, 2));
    zip.file("接入说明.md", buildHandoff(project.value, exportOptions.value));
    download(await zip.generateAsync({ type: "blob" }), filename() + ".zip");
    tell("接入包已导出：包含 Lua、工程和接入说明。");
  } catch (error) { tell("导出失败：" + (error as Error).message, true); }
  finally { exporting.value = false; }
}
function applyWorkspaceProject(serialized: string) {
  const next = parseProject(JSON.parse(serialized));
  project.value = next; selectedId.value = next.emitters[0].id;
  previousProject.value = null; time.value = 0; playing.value = false;
}
function stopDocumentInteraction() {
  playing.value = false; lastTime = 0;
  if (drag && stage.value?.hasPointerCapture(drag.id)) stage.value.releasePointerCapture(drag.id);
  drag = null; libraryOpen.value = false; exportOpen.value = false;
}
async function runArchiveAction(action: () => Promise<unknown>) {
  try { await action(); return true; }
  catch (cause) {
    if (archive) archive.error.value = (cause as Error).message || String(cause);
    workspacePanelOpen.value = true; return false;
  }
}
async function initializeOrSave() {
  if (!archive || !repository || !sharedStorage || archiveBusy.value) return;
  if (archive.ready.value) { await saveCurrentDocument(); return; }
  initializingArchive.value = true;
  try {
    await migrateParticleLegacy(sharedStorage, repository, legacyProject);
    await archive.initialize();
    if (archive.selectedDocument.value) playing.value = true;
  } catch (cause) {
    archive.error.value = (cause as Error).message || String(cause);
    archive.status.value = "读取存档失败"; workspacePanelOpen.value = true;
  } finally { initializingArchive.value = false; }
}
async function saveCurrentDocument() {
  if (!archive) { saveLocal(); return; }
  await runArchiveAction(() => archive.save());
}
async function switchWorkspace(name: string) {
  if (!archive) return;
  await runArchiveAction(() => archive.switchWorkspace(name));
}
async function switchDocument(name: string) {
  if (!archive) return;
  if (await runArchiveAction(() => archive.switchDocument(name))) workspacePanelOpen.value = false;
}
function openImport() {
  if (archive && !archive.selectedWorkspace.value) { workspacePanelOpen.value = true; return; }
  fileInput.value?.click();
}
function requestArchiveAction(kind: ArchiveActionKind) {
  if (!archive || archiveBusy.value || !archive.ready.value) return;
  const workspace = archive.selectedWorkspace.value, document = archive.selectedDocument.value;
  if (kind !== "createWorkspace" && !workspace) { workspacePanelOpen.value = true; return; }
  if ((kind === "renameDocument" || kind === "deleteDocument") && !document) return;
  const content: Record<ArchiveActionKind, [string, string, string]> = {
    createWorkspace: ["新建工作区", "工作区用于保存多个独立的粒子特效文件。", "新工作区"],
    renameWorkspace: ["重命名工作区", "工作区内的所有特效文件会保留。", workspace],
    deleteWorkspace: ["删除工作区", "将「" + workspace + "」及其特效文件移至回收站？当前页面可撤销最近一次删除。", ""],
    createDocument: ["新建特效文件", "在当前工作区创建一个独立的粒子特效。", "新建特效"],
    renameDocument: ["重命名特效文件", "发射器、图片、曲线和其他参数会保留。", document],
    deleteDocument: ["删除特效文件", "将「" + document + "」移至回收站？当前页面可撤销最近一次删除。", ""],
  };
  const [title, message, initialValue] = content[kind];
  archive.error.value = "";
  archiveAction.value = { kind, title, message, initialValue, mode: kind.startsWith("delete") ? "confirm" : "name" };
}
async function confirmArchiveAction(value: string) {
  if (!archive || archiveBusy.value || !archiveAction.value) return;
  if (value.length > 80) { archive.error.value = "名称不能超过 80 个字符"; return; }
  const kind = archiveAction.value.kind;
  const success = await runArchiveAction(async () => {
    if (kind === "createWorkspace") await archive.createWorkspace(value);
    else if (kind === "renameWorkspace") await archive.renameWorkspace(value);
    else if (kind === "deleteWorkspace") await archive.deleteWorkspace();
    else if (kind === "createDocument") await archive.createDocument(value);
    else if (kind === "renameDocument") await archive.renameDocument(value);
    else await archive.deleteDocument();
  });
  if (success) {
    archiveAction.value = null;
    if (kind === "createDocument") { workspacePanelOpen.value = false; playing.value = true; }
  }
}
function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (archive?.dirty.value || archiveBusy.value || (hasOpenDocument.value && validationError.value)) {
    event.preventDefault(); event.returnValue = "";
  }
}
let saveTimer: ReturnType<typeof setTimeout> | undefined, frameId = 0, lastTime = 0;
function saveLocal() {
  if (validationError.value) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project.value)); storageError.value = ""; }
  catch { storageError.value = "自动保存不可用，请保存工程"; }
}
watch(project, () => {
  if (archive) {
    // The sync watcher sees loading/busy during staged validation and switches.
    if (archive.ready.value && !archive.busy.value && !archive.loading.value && !validationError.value) {
      archive.queueSave(JSON.stringify(parseProject(project.value)));
    }
  } else { clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 350); }
}, { deep: true, flush: "sync" });
function animate(now: number) {
  if (playing.value && !editingBlocked.value && !document.hidden && lastTime) {
    const next = time.value + Math.min((now - lastTime) / 1000, .1) * playbackSpeed.value;
    if (next >= project.value.previewDuration) {
      time.value = previewLoop.value ? next % project.value.previewDuration : project.value.previewDuration;
      if (!previewLoop.value) playing.value = false;
    } else time.value = next;
  }
  lastTime = now; frameId = requestAnimationFrame(animate);
}
function keyboard(event: KeyboardEvent) {
  if (event.target instanceof HTMLElement && (event.target.closest("input, textarea, select, button, [contenteditable]") || libraryOpen.value || exportOpen.value || workspacePanelOpen.value || archiveAction.value || editingBlocked.value)) return;
  if (event.code === "Space") { event.preventDefault(); togglePlay(); }
}
onMounted(() => {
  void loadImageCatalog(); void initializeOrSave(); frameId = requestAnimationFrame(animate);
  window.addEventListener("keydown", keyboard); window.addEventListener("beforeunload", handleBeforeUnload);
});
onBeforeRouteLeave(async () => {
  if (!archive) return true;
  if (initializingArchive.value) return false;
  return runArchiveAction(() => archive.prepareToLeave());
});
onUnmounted(() => {
  cancelAnimationFrame(frameId); clearTimeout(saveTimer);
  if (archive) void archive.dispose().catch(error => console.error("UI 特效存档保存失败", error));
  else saveLocal();
  window.removeEventListener("keydown", keyboard); window.removeEventListener("beforeunload", handleBeforeUnload);
});
</script>


<style scoped>
.workspace-button { display:inline-flex; align-items:center; gap:7px; flex-shrink:0; background:transparent; border-color:transparent; }
.current-file { min-width:110px; max-width:210px; display:flex; flex-direction:column; gap:4px; align-items:flex-start; text-align:left; background:transparent; border:0; border-radius:0; border-right:1px solid #343c4f; padding:0 18px 0 2px; }
.current-file strong,.current-file span { width:100%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.current-file strong { font-size:12px; color:#d4daeb; }.current-file span { font-size:10px; color:#8b9bb6; }
.new-file-button { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
.editor-toolbar .save-state { background:transparent; border:0; padding:4px; white-space:nowrap; }
.project-name>span { display:flex; align-items:center; justify-content:space-between; }
.editor-layout { position:relative; }
.archive-empty { position:absolute; inset:0; z-index:90; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:14px; background:#121824ed; color:#b7c6e0; text-align:center; padding:25px; }
.archive-empty strong { font-size:18px; }.archive-empty p { color:#8698b5; max-width:520px; line-height:1.8; }
.archive-undo { position:absolute; bottom:18px; left:50%; transform:translateX(-50%); z-index:100; box-shadow:0 4px 20px #0008; white-space:nowrap; }
@media (max-width:1080px) { .current-file { max-width:165px; min-width:90px; padding-right:10px; } .workspace-button { padding:7px; } .editor-toolbar { gap:5px; } }
@media (max-width:820px) { .editor-toolbar { flex-wrap:wrap; } .current-file { max-width:170px; flex:1; } .workspace-button { padding:7px 3px; } .toolbar-spacer { display:none; } }

.particle-editor { --panel:#171c27; --edge:#2a3140; --text:#e2e8f4; --accent:#b8a2ff; display:flex; flex-direction:column; min-height:500px; color:var(--text); background:#11151e; border:1px solid #303544; border-radius:12px; overflow:hidden; font-family:Inter,"Microsoft YaHei",sans-serif; font-size:12px; }
.particle-editor * { box-sizing:border-box; }
button,input,select { font:inherit; }
button { color:#c9d1e2; background:#242b39; border:1px solid #384154; border-radius:6px; padding:7px 11px; cursor:pointer; transition:background .15s,border-color .15s; }
button:hover:not(:disabled) { background:#33394d; border-color:#665a88; color:#fff; }
button:disabled { opacity:.35; cursor:default; }
button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
input[type=checkbox] { accent-color:#a991ee; margin:0; width:13px; height:13px; cursor:pointer; }
.editor-toolbar { display:flex; align-items:center; gap:9px; min-height:66px; padding:12px 20px; border-bottom:1px solid var(--edge); background:#1a1e2a; flex-shrink:0; }
.brand-mark { display:grid; place-items:center; width:36px; height:36px; border:1px solid #766199; background:linear-gradient(135deg,#3c305e,#252236); border-radius:10px; color:#d1b8ff; font-size:26px; }
.brand { display:flex; flex-direction:column; gap:3px; margin-right:3px; }
.brand strong { font-size:15px; letter-spacing:.05em; color:#f1edff; }
.brand span { font-size:10px; color:#8f95a7; }
.prototype-tag { font-size:9px; color:#bba4ed; border:1px solid #544467; border-radius:4px; padding:2px 5px; }
.toolbar-spacer,.transport-spacer { flex:1; }
.save-state { font-size:10px; color:#7b8a9e; margin-right:8px; }
.save-state.warning { color:#efbc84; }
.quiet-button { background:transparent; border-color:transparent; }
.primary-button { background:#b5a0f1; color:#201b32; border:1px solid #c9b5ff; font-weight:700; }
.primary-button:hover:not(:disabled) { background:#cab9ff; border-color:#e0d4ff; color:#201b32; }
.notice { display:flex; justify-content:space-between; align-items:center; padding:6px 18px; background:#263142; color:#c9d7ed; border-bottom:1px solid var(--edge); font-size:11px; flex-shrink:0; }
.notice.error { background:#402d2c; color:#ffc4a8; }
.notice button { padding:0 6px; border:0; background:none; }
.editor-layout { display:grid; grid-template-columns:210px minmax(200px,1fr) 300px; min-height:0; flex:1; overflow:hidden; }
.left-panel,.inspector { background:var(--panel); min-height:0; display:flex; flex-direction:column; }
.left-panel { border-right:1px solid var(--edge); overflow-y:auto; scrollbar-width:thin; }
.inspector { border-left:1px solid var(--edge); }
.panel-heading { display:flex; align-items:center; justify-content:space-between; min-height:43px; padding:12px 15px; border-bottom:1px solid var(--edge); font-weight:600; font-size:11px; }
.panel-heading small { margin-left:5px; color:#778197; font-weight:400; }
.eyebrow { letter-spacing:.12em; color:#717c92; font-size:8px; font-weight:500; }
.text-field { display:block; }
.text-field>span { display:block; color:#929db0; font-size:10px; margin-bottom:7px; }
.text-field input { width:100%; min-width:0; color:#e1e7f3; background:#10151f; border:1px solid #343d50; border-radius:5px; height:32px; padding:6px 9px; }
.text-field small { color:#758299; font-weight:400; margin-left:5px; }
.project-name { margin:15px 13px 12px; }
.project-size { margin:0 13px; }
.pair { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:9px; }
.section-label { font-size:10px; color:#737f95; padding:20px 14px 9px; }
.presets { display:flex; flex-direction:column; gap:7px; padding:0 11px 15px; }
.preset-card { display:flex; align-items:center; gap:10px; width:100%; padding:8px; text-align:left; background:#1e2431; border-color:#333849; }
.preset-card>span:nth-child(2) { display:flex; flex-direction:column; gap:5px; }
.preset-card strong { font-size:11px; font-weight:500; }
.preset-card small { color:#78849b; font-size:9px; white-space:nowrap; }
.preset-art { flex-shrink:0; width:35px; height:37px; display:grid; place-items:center; font-size:26px; border-radius:6px; color:#ecc58c; background:radial-gradient(ellipse at center,#554329 0%,#25252b 75%); }
.snow .preset-art { color:#b5daff; background:radial-gradient(ellipse at center,#294462,#1d2837 75%); }
.coins .preset-art { color:#f1d19a; background:radial-gradient(ellipse at center,#60523a,#29252b 75%); }
.preset-arrow { color:#5e6b84; margin-left:auto; }
.emitter-heading { border-top:1px solid var(--edge); }
.emitter-heading button { border:0; padding:0 5px; background:none; font-size:19px; }
.emitter-list { padding:8px; }
.emitter-row { display:flex; align-items:center; gap:7px; padding:4px 7px; border:1px solid transparent; border-radius:6px; }
.emitter-row.selected { border-color:#615581; background:#322b45; }
.emitter-row.muted { opacity:.5; }
.emitter-select { flex:1; min-width:0; display:flex; align-items:center; gap:8px; background:transparent; border:0; text-align:left; padding:6px 0; font-size:11px; }
.emitter-select span:last-child { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.layer-number { color:#8e7eaf; font-size:9px; }
.emitter-dot { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
.layer-actions { display:flex; gap:5px; padding:0 12px 14px; }
.layer-actions button { font-size:10px; padding:5px 8px; background:transparent; border-color:#303747; }
.layer-actions button:last-child { margin-left:auto; }
.budget-card { margin:auto 12px 14px; border:1px solid #2e3647; border-radius:8px; padding:12px; background:#141a25; }
.budget-card>div:first-child { display:flex; align-items:center; gap:6px; font-size:10px; color:#a6b2c9; }
.budget-card strong { margin-left:auto; color:#d9e4fa; font-size:20px; font-weight:500; }
.live-dot { width:5px; height:5px; border-radius:50%; background:#a9d8b8; display:inline-block; }
.budget-track { height:3px; background:#283145; border-radius:3px; margin:9px 0; overflow:hidden; }
.budget-track i { height:100%; display:block; background:#aa91db; }
.budget-card small { color:#7f8ca4; font-size:9px; }
.budget-card p { line-height:1.7; font-size:10px; color:#66758e; margin:9px 0 0; }
.left-footer { border-top:1px solid var(--edge); padding:13px; font-size:9px; color:#6e7d94; }
.workspace { display:flex; flex-direction:column; min-width:0; min-height:0; }
.stage-toolbar { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; min-height:43px; background:#181c26; border-bottom:1px solid #292f3e; flex-shrink:0; gap:8px; }
.stage-title { display:flex; align-items:center; gap:8px; }
.stage-title strong { font-size:11px; font-weight:500; }
.stage-title>span:last-child { color:#707e93; font-size:10px; margin-left:6px; }
.stage-options { display:flex; align-items:center; gap:10px; color:#8792a6; font-size:10px; }
.stage-options label { display:flex; gap:5px; align-items:center; white-space:nowrap; }
.stage-options button { padding:2px 6px; border:0; background:transparent; font-size:17px; }
.stage-options button.active { color:#d2bdfc; background:#3a304f; }
.stage-area { flex:1; min-height:180px; display:flex; flex-direction:column; padding:16px 22px 13px; background:radial-gradient(ellipse at 50% 42%,#1f2333,#10141d 80%); overflow:hidden; }
.stage-caption,.stage-footnote { display:flex; align-items:center; justify-content:space-between; color:#55637d; font-size:9px; gap:9px; }
.stage-caption>span:first-child { letter-spacing:.2em; font-size:8px; }
.canvas-holder { min-height:0; flex:1; display:flex; padding:22px 0; }
.particle-stage { width:100%; height:100%; overflow:hidden; touch-action:none; }
.canvas-background { fill:#0d111a; stroke:#343e52; stroke-width:1; }
.grid-fill { color:#30394d; opacity:.5; }
.axes path { fill:none; stroke:#39425a; stroke-width:.8; stroke-dasharray:4 7; }
.stage-footnote { color:#6c7890; font-size:10px; min-height:18px; }
.asset-warning { color:#c6a978; }
.light { background:#bcc1cc; }
.light .canvas-background { fill:#e3e6ef; stroke:#8a92a5; }
.light .grid-fill { color:#8791a6; }
.light .stage-caption,.light .stage-footnote { color:#47536d; }
.shape-guide { fill:#ae98ef08; stroke:#9981ce; stroke-width:1; stroke-dasharray:4 5; }
.control-line { fill:none; stroke:#657a9e; stroke-width:1.2; stroke-dasharray:5 5; }
.bezier-guide { fill:none; stroke:#a996dd; stroke-width:1.7; }
.drag-handle,.origin-handle { cursor:grab; }
.drag-handle:active,.origin-handle:active { cursor:grabbing; }
.drag-handle circle { fill:#24243d; stroke:#b8a4ed; stroke-width:2; }
.emitter-guides text { fill:#afa2cf; font-size:11px; user-select:none; }
.origin-handle circle { fill:#1c1c3099; stroke:#b9a4ee; stroke-width:1.3; }
.origin-handle path { fill:none; stroke:#b9a4ee; stroke-width:1.3; }
.transport { border-top:1px solid var(--edge); background:#171d28; padding:12px 20px 10px; flex-shrink:0; }
.transport-top { display:flex; align-items:center; gap:10px; }
.restart-button { font-size:20px; padding:0 4px; border:0; background:none; }
.play-button { width:30px; height:29px; padding:0; color:#d5c2ff; background:#3a3050; border-color:#5a4976; font-size:12px; }
.time-display { display:flex; align-items:baseline; gap:6px; font-variant-numeric:tabular-nums; }
.time-display strong { color:#d3dbef; font-size:16px; font-weight:500; }
.time-display span { color:#697790; font-size:10px; }
.loop-preview { display:flex; align-items:center; gap:6px; color:#8694ab; font-size:10px; }
.transport select { background:#202939; border:1px solid #35405a; border-radius:5px; padding:4px; color:#a6b5ce; font-size:10px; }
.timeline { width:100%; margin:18px 0 0; height:4px; accent-color:#b6a0ef; cursor:ew-resize; display:block; }
.timeline-ticks { display:flex; justify-content:space-between; margin-top:8px; color:#65718a; font-size:9px; font-variant-numeric:tabular-nums; }
.transport-bottom { margin-top:13px; padding-top:9px; border-top:1px solid #262f40; display:flex; align-items:center; justify-content:space-between; gap:15px; }
.transport-bottom>span { font-size:9px; color:#61708a; }
.transport-bottom :deep(.number-field) { max-width:140px; }
.inspector-scroll { padding:15px; overflow-y:auto; min-height:0; scrollbar-width:thin; scrollbar-color:#3a4255 transparent; }
.image-card { display:flex; gap:12px; align-items:center; padding:12px; background:#1e2330; border:1px solid #31384a; border-radius:8px; margin-top:13px; }
.image-preview { width:56px; height:56px; padding:6px; background-color:#101622; background-image:linear-gradient(45deg,#ffffff07 25%,transparent 25%,transparent 75%,#ffffff07 75%),linear-gradient(45deg,#ffffff07 25%,transparent 25%,transparent 75%,#ffffff07 75%); background-size:12px 12px; background-position:0 0,6px 6px; border-color:#3a4152; }
.image-preview span { font-size:26px; color:#bdacd9; }
.image-card>div { display:flex; flex-direction:column; gap:5px; }
.image-card strong { font-weight:500; font-size:11px; }
.image-card small { color:#7986a0; font-size:10px; }
.text-button { padding:0; border:0; background:transparent; color:#ba9fee; font-size:10px; text-align:left; }
details { border-bottom:1px solid #2b3342; padding-bottom:13px; }
summary { list-style:none; display:flex; align-items:center; gap:8px; padding:16px 0 12px; cursor:pointer; font-weight:500; font-size:11px; }
summary::-webkit-details-marker { display:none; }
summary::after { content:"⌄"; color:#72809b; margin-left:auto; }
details:not([open]) summary::after { content:"›"; }
summary>span { color:#746890; font-size:9px; }
summary small { color:#64728a; font-size:9px; font-weight:400; margin-left:auto; }
details>.pair,details>.range-row,details>.segmented { margin-bottom:10px; }
.check-field { display:flex; align-items:center; gap:7px; font-size:11px; color:#a6b1c5; margin:12px 0; }
.segmented { display:flex; padding:3px; gap:3px; border:1px solid #30394c; border-radius:6px; background:#121824; }
.segmented button { flex:1; border:1px solid transparent; background:transparent; padding:6px 2px; font-size:10px; color:#7788a4; }
.segmented button.active { color:#d4c6f5; background:#342d47; border-color:#5c4c78; }
.range-row>span { display:block; color:#98a5bc; font-size:10px; margin-bottom:5px; }
.range-row>span small { color:#5f6e87; font-size:9px; }
.range-row :deep(.number-field>span) { font-size:9px; }
.hint { color:#6f7f99; font-size:10px; line-height:1.8; margin:10px 0 0; }
.field-warning { color:#e6b883; font-size:11px; line-height:1.7; }
.field-warning button { margin-left:7px; }
.modal-backdrop { position:absolute; inset:0; z-index:80; background:#090c14bf; backdrop-filter:blur(5px); display:flex; align-items:center; justify-content:center; padding:20px; }
.export-dialog { width:610px; max-width:100%; max-height:100%; overflow-y:auto; padding:25px; background:#1a202d; border:1px solid #444b63; border-radius:14px; box-shadow:0 24px 100px #0008; }
.modal-heading { display:flex; justify-content:space-between; align-items:flex-start; }
.modal-heading .eyebrow { font-size:9px; color:#b69ade; }
.modal-heading h2 { font-size:21px; color:#e4daf7; font-weight:500; margin:9px 0 0; }
.modal-heading button { border:0; background:none; font-size:23px; padding:0 4px; }
.export-dialog>p { color:#8d9db7; line-height:1.9; font-size:11px; margin:15px 0 18px; }
.export-dialog .text-field { margin-top:20px; }
.export-facts { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:14px; border:1px solid #343d51; background:#141b27; border-radius:8px; margin-top:17px; }
.export-facts div { display:flex; flex-direction:column; gap:6px; }
.export-facts small { font-size:9px; color:#778aa8; }
.export-facts strong { font-size:16px; font-weight:500; color:#d0c0f4; }
.lua-preview { border-top:1px solid #30384a; }
.lua-preview pre { max-height:170px; overflow:auto; background:#111722; padding:12px; color:#adb7c9; font-size:10px; }
.export-dialog .export-note { font-size:10px; color:#7888a1; margin:13px 0 20px; }
.modal-actions { display:flex; justify-content:flex-end; gap:9px; }
.modal-actions button:first-child { margin-right:auto; background:transparent; }
@media (min-width:1550px) { .editor-layout { grid-template-columns:232px minmax(200px,1fr) 324px; } .stage-area { padding:22px 35px 18px; } .canvas-holder { padding:35px 0; } }
@media (max-width:1080px) { .editor-layout { grid-template-columns:180px minmax(200px,1fr) 270px; } .save-state,.prototype-tag { display:none; } .editor-toolbar { padding:12px; } .stage-toolbar { padding:10px; } .stage-title>span:last-child { display:none; } .stage-area { padding:12px; } .preset-card { gap:6px; } .preset-art { width:26px; } .preset-card small { font-size:8px; } }
@media (max-width:820px) { .editor-layout { grid-template-columns:minmax(260px,1fr) 250px; } .left-panel { display:none; } .brand span,.quiet-button:first-of-type { display:none; } .brand strong { font-size:12px; } .editor-toolbar { gap:4px; } .editor-toolbar button { padding:7px; font-size:10px; } .transport { padding:12px; } }
@media (max-width:820px) { .particle-editor { overflow:auto; } .editor-layout { display:flex; flex-direction:column; overflow:visible; } .workspace { flex-shrink:0; height:420px; } .inspector { min-height:300px; overflow:visible; border-left:0; } .inspector-scroll { overflow:visible; } .editor-toolbar { flex-wrap:wrap; } .brand-mark { width:28px; height:28px; } .left-panel { display:flex; max-height:310px; flex-shrink:0; border-bottom:1px solid var(--edge); } .budget-card,.left-footer { display:none; } .presets { flex-direction:row; } .preset-card { flex:1; min-width:0; } .preset-art,.preset-card small,.preset-arrow,.section-label { display:none; } .emitter-list { max-height:120px; overflow-y:auto; } }
</style>




<style scoped>
@media (max-width:1180px) { .editor-toolbar { flex-wrap:wrap; } }
</style>
