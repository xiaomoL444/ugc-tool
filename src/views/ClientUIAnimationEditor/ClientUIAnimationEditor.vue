<template>
  <div ref="editorElement" class="animation-editor" :class="{ 'is-timeline-resizing': timelineResizing, 'is-timeline-scrubbing': timelineScrubbing }" :inert="archive?.busy.value || editorHistory.busy.value" :style="editorStyle" @pointerdown.capture="beginEditorHistoryPointer" @focusin.capture="beginEditorHistoryInput" @input.capture="beginEditorHistoryInput" @focusout.capture="endEditorHistoryInput" @pointerdown="closeMenus" @contextmenu.prevent>
    <header class="editor-toolbar">
      <button class="tool-button workspace-button" aria-label="管理工作区和编辑文件" @click.stop="workspacePanelOpen = true"><EditorIcon name="folder" :size="15" />工作区</button>
      <div class="project-copy"><strong :title="archive?.selectedWorkspace.value">{{ archive?.selectedWorkspace.value || '客户端控件动画' }}</strong><span :title="projectName">{{ hasOpenDocument ? projectName : '未打开编辑文件' }}</span></div>
      <div class="toolbar-divider"></div>
      <button class="tool-button" @click.stop="resetProject"><EditorIcon name="plus" :size="15" />新建文件</button>
      <button class="tool-button" :disabled="!hasOpenDocument" @click.stop="saveProject"><EditorIcon name="save" :size="15" />保存</button>
      <div class="history-tools" @pointerdown.stop>
        <button class="history-icon-button" aria-label="撤销" title="撤销 · Ctrl+Z" :disabled="!hasOpenDocument || !editorHistory.canUndo.value || editorHistory.busy.value" @click.stop="undoEditorOperation"><EditorIcon name="undo" :size="16" /></button>
        <button class="history-icon-button" aria-label="重做" title="重做 · Ctrl+Shift+Z / Ctrl+Y" :disabled="!hasOpenDocument || !editorHistory.canRedo.value || editorHistory.busy.value" @click.stop="redoEditorOperation"><EditorIcon name="redo" :size="16" /></button>
        <button class="history-icon-button" aria-label="操作记录" title="操作记录 · 最近 100 个行为" :aria-expanded="historyPanelOpen" @click.stop="historyPanelOpen = !historyPanelOpen"><EditorIcon name="history" :size="16" /></button>
        <EditorHistoryPanel v-if="historyPanelOpen" :entries="editorHistory.entries.value" :index="editorHistory.index.value" :busy="editorHistory.busy.value" :can-undo="editorHistory.canUndo.value" :can-redo="editorHistory.canRedo.value" @undo="undoEditorOperation" @redo="redoEditorOperation" @close="historyPanelOpen = false" />
      </div>
      <div class="import-wrap" @pointerdown.stop @keydown.esc.stop.prevent="importMenuOpen = false" @focusout="onImportMenuFocusOut">
        <button class="tool-button" aria-label="导入文件" :aria-expanded="importMenuOpen" aria-controls="client-ui-import-menu" @click.stop="toggleImportMenu">{{ psdImportBusy ? psdImportProgress : '导入' }} <span aria-hidden="true">⌄</span></button>
        <div v-if="importMenuOpen" id="client-ui-import-menu" class="import-menu">
          <button @click.stop="openProject"><b>导入 JSON</b><small>工程文件</small></button>
          <button @click.stop="openGiaFile"><b>导入 Gia</b><small>客户端控件容器</small></button>
          <button :disabled="psdImportBusy" @click.stop="openPsdFile"><b>导入 PSD</b><small>{{ psdImportBusy ? psdImportProgress : 'Photoshop 图层文件' }}</small></button>
          <button :disabled="spineImportBusy" @click.stop="openSpineFolder"><b>导入 Spine 动画文件夹</b><small>{{ spineImportBusy ? '正在读取 Spine…' : 'skeleton.json + 原始图片 · 无需 .spine · Spine 3.8' }}</small></button>
        </div>
      </div>
      <div class="export-wrap" @pointerdown.stop @keydown.esc.stop.prevent="exportMenuOpen = false" @focusout="onExportMenuFocusOut">
        <button class="tool-button" :disabled="!hasOpenDocument" aria-label="导出文件" :aria-expanded="exportMenuOpen" aria-controls="client-ui-export-menu" @click.stop="toggleExportMenu">导出 <span aria-hidden="true">⌄</span></button>
        <div v-if="exportMenuOpen" id="client-ui-export-menu" class="export-menu">
          <button :disabled="!hasOpenDocument" @click.stop="downloadProject"><b>导出 JSON</b><small>工程文件</small></button>
          <button :disabled="!hasOpenDocument" title="导出当前控件树的基础参数为原生客户端 UI GIA" @click.stop="openGiaExport"><b>导出 Gia</b><small>容器控件</small></button>
        </div>
      </div>
      <button class="tool-button" :disabled="!hasOpenDocument" @click.stop="openControlTemplateLibrary">控件模板</button>
      <button class="tool-button" :disabled="!hasOpenDocument" @click.stop="openPrimitiveResourceLibrary">图片资源</button>
      <button class="tool-button" :disabled="!hasOpenDocument || !fittedPrimitiveNodes.length" :aria-pressed="allPrimitivesFitted" title="一键切换所有图元控件的显示；尚未拟合的图片继续显示原图" @click.stop="toggleAllPrimitivePreviews">{{ allPrimitivesFitted ? '全部显示原图' : '全部显示拟合' }}</button>
      <button class="archive-status" :class="{ 'has-error': archive?.error.value }" :title="archive?.error.value || archive?.status.value" @click.stop="workspacePanelOpen = true">{{ archive?.status.value || 'JSON 文件模式' }}</button>
      <div class="lua-export-wrap" @pointerdown.stop>
        <button class="tool-button lua-export-button" aria-label="Lua 导入与导出" title="导入动画数据，或导出动画、图元数据及独立运行库" @click.stop="importMenuOpen = false; exportMenuOpen = false; luaExportMenuOpen = !luaExportMenuOpen">Lua 工具 <span>⌄</span></button>
        <span class="lua-lib-version" :title="`当前可导出的 TweenTimelineLib 版本：@${TWEEN_TIMELINE_LIB_VERSION}。不代表游戏项目中已安装的版本；更新时请重新导出运行库。`">Lib:v{{ TWEEN_TIMELINE_LIB_VERSION }}</span>
        <div v-if="luaExportMenuOpen" class="lua-export-menu">
          <button :disabled="!hasOpenDocument" @click.stop="openTimelineDataImport"><b>导入 Timeline Data</b><small>从 Data 还原控件的动画时间轴</small></button>
          <button @click.stop="exportTweenTimelineLib"><b>导出TweenTimeline运行库</b><small>TweenTimelineLib.lua · v{{ TWEEN_TIMELINE_LIB_VERSION }} · 放入 Lib</small></button>
          <button :disabled="!selectedNode" @click.stop="exportSelectedNodeTweenData"><b>导出 Timeline Data</b><small>{{ selectedNode ? `${activeAnimation.name} · 以 ${selectedNode.name} 为根控件` : '请先选择根控件' }}</small></button>
          <button :disabled="!selectedNode" @click.stop="exportSelectedPrimitiveProject"><b>导出图元项目 Lua</b><small>{{ selectedNode ? `以 ${selectedNode.name} 为根控件 · 导出自身及子级图元` : '请先选择根控件' }}</small></button>
          <button @click.stop="exportPrimitiveImageLib"><b>导出图元运行库</b><small>PrimitiveImageLib.lua · 独立生成图片集合</small></button>
        </div>
      </div>
      <input ref="fileInput" class="file-input" type="file" accept="application/json,.json" @change="loadProject" />
      <input ref="giaFileInput" class="file-input" type="file" accept=".gia,application/octet-stream" @change="loadGiaFile" />
      <input ref="psdFileInput" class="file-input" type="file" accept=".psd,image/vnd.adobe.photoshop" @change="loadPsdFile" />
      <input ref="spineFileInput" class="file-input" type="file" webkitdirectory multiple @change="loadSpineFolder" />
      <span v-if="giaImportStatus" class="gia-import-status" :title="giaImportStatus">{{ giaImportStatus }}</span>
      <div class="toolbar-spacer"></div>
      <PreviewPresetSelect :groups="previewPresetGroups" :device-id="deviceMode" :preset-id="previewPresetId" :custom-label="customCanvasLabel" @select="selectPreviewPreset" />
      <div class="zoom-control"><button aria-label="缩小画布" @click.stop="zoom = Math.max(0.01, zoom - 0.1)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button aria-label="放大画布" @click.stop="zoom = Math.min(1.5, zoom + 0.1)">＋</button></div>
      <button class="icon-button" title="适应画布" aria-label="适应画布" @click.stop="fitCanvas"><EditorIcon name="fit" /></button>
    </header>

    <ImageAssetLibrary v-if="imageLibraryOpen && selectedNode?.type === 'image'" :key="selectedId ?? ''" :selected-id="selectedNode.properties.imageId" @select="selectImageAsset" @close="imageLibraryOpen = false" />
    <GiaExportDialog v-if="giaExportOpen" :project-name="projectName" :initial-index="originalGiaUIIndex(giaSource)" :count="nodes.length" :has-source="!!giaSource" :busy="giaExportBusy" :error="giaExportError" :notice="giaExportNotice" @close="giaExportOpen = false" @export="downloadGiaUI" @source="attachGiaSource" />
    <ControlTemplateLibrary v-if="templateLibraryOpen" :assets="controlTemplates" :selected-index="selectedNode?.type === 'reference' ? selectedNode.properties.referencedPrefabIndex : null" :selectable="selectedNode?.type === 'reference'" :device-index="templateDeviceIndex" @select="selectControlTemplate" @save="saveControlTemplate" @close="templateLibraryOpen = false" />
    <PrimitiveResourceLibrary v-if="primitiveResourceLibraryOpen" :key="keyframeDocumentEpoch" :assets="primitiveResources" :selected-id="selectedNode?.type === 'primitive' ? selectedNode.properties.imageResourceId ?? null : null" :selectable="selectedNode?.type === 'primitive'" :usage="primitiveResourceUsage" @save="savePrimitiveResource" @remove="removePrimitiveResource" @select="selectPrimitiveResource" @close="primitiveResourceLibraryOpen = false" />
    <div class="editor-body" :class="{ 'is-animations-collapsed': animationsPanelCollapsed }">
      <aside class="hierarchy-panel panel">
        <div class="panel-heading">
          <div><h2>控件层级 <span class="heading-count">{{ nodes.length }}</span></h2></div>
          <button class="square-button" title="添加控件" aria-label="添加控件" :aria-expanded="addMenuOpen" @click.stop="addMenuOpen = !addMenuOpen"><EditorIcon name="plus" /></button>
          <div v-if="addMenuOpen" class="add-menu" @pointerdown.stop>
            <button v-for="control in addControlDefinitions" :key="control.type" @click="addNode(control.type)"><span>{{ control.icon }}</span><div><b>{{ control.label }}</b><small>{{ control.description }}</small></div></button>
          </div>
        </div>
        <div class="search-box"><EditorIcon name="search" :size="17" /><input v-model="search" placeholder="搜索控件" aria-label="搜索控件" /><button v-if="search" class="search-clear" aria-label="清空搜索" @click="search = ''">×</button></div>
        <div ref="hierarchyTree" class="tree" :class="{ 'is-hierarchy-dragging': hierarchyDrag.active }" @pointerdown.stop>
          <div v-if="hierarchyDrag.active" class="root-drop-hint" :class="{ active: hierarchyDrag.dropMode === 'inside' && hierarchyDrag.dropTargetId === rootContainer?.id }">拖到空白处 · 放到根层级</div>
          <button v-for="item in visibleTree" :key="item.node.id" class="tree-row" :class="{ selected: item.node.id === selectedId, muted: !item.node.visible, 'root-node': item.node.id === rootContainer?.id, dragging: hierarchyDrag.active && hierarchyDrag.nodeId === item.node.id, 'drop-inside': hierarchyDrag.active && hierarchyDrag.dropMode === 'inside' && hierarchyDrag.dropTargetId === item.node.id, 'drop-before': hierarchyDrag.active && hierarchyDrag.dropMode === 'before' && hierarchyDrag.dropTargetId === item.node.id, 'drop-after': hierarchyDrag.active && hierarchyDrag.dropMode === 'after' && hierarchyDrag.dropTargetId === item.node.id }" :data-node-id="item.node.id" :style="{ paddingLeft: `${12 + item.depth * 18}px` }" :title="item.node.id === rootContainer?.id ? '唯一根容器' : '长按并拖动；边缘调整顺序，中间设为子级'" @pointerdown="startHierarchyPress($event, item.node)" @click="selectHierarchyNode(item.node, $event)">
            <span class="chevron" @pointerdown.stop @click.stop="toggleCollapsed(item.node.id)">{{ hasChildren(item.node.id) ? (collapsed.has(item.node.id) ? '›' : '⌄') : '' }}</span>
            <EditorIcon class="node-icon" :name="controlIconName(item.node.type)" :size="17" /><span class="node-name">{{ item.node.name }}</span><span class="visibility" :title="item.node.visible ? '隐藏控件' : '显示控件'" @pointerdown.stop @click.stop="item.node.visible = !item.node.visible"><EditorIcon :name="item.node.visible ? 'eye' : 'eye-off'" :size="15" /></span>
          </button>
          <div v-if="visibleTree.length === 0" class="empty-state">没有匹配的控件</div>
        </div>
        <div v-if="hierarchyDrag.active" class="hierarchy-drag-ghost" :style="hierarchyDragGhostStyle"><span>{{ nodeIcon(draggedHierarchyNode?.type ?? 'container') }}</span><b>{{ draggedHierarchyNode?.name }}</b><small>{{ hierarchyDrag.dropLabel }}</small></div>
        <div class="hierarchy-actions"><button v-if="boneToolsEnabled" class="bone-create-toggle" :class="{ active: boneCreateMode }" :aria-pressed="boneCreateMode" :disabled="!hasOpenDocument" title="拖拽创建骨骼 · 单击骨骼切换父级 · Ctrl 点击控件归入当前骨骼 · Esc 退出" @click.stop="toggleBoneCreateMode">以骨骼模式添加</button><button class="add-control-button" @click.stop="addMenuOpen = true"><EditorIcon name="plus" :size="16" />添加控件</button><button aria-label="删除选中控件" :disabled="!selectedNode || selectedNode.id === rootContainer?.id" :title="selectedNode?.id === rootContainer?.id ? '根容器不可删除' : '删除选中控件'" @click="removeSelected"><EditorIcon name="trash" :size="16" /></button></div>
      </aside>

      <main class="workspace-panel">
        <div class="workspace-tabs"><span class="workspace-label"><EditorIcon name="scene" :size="16" />场景画布</span><button class="bone-mode-toggle" :class="{ active: boneToolsEnabled }" :aria-pressed="boneToolsEnabled" :disabled="!hasOpenDocument" title="展开骨骼编辑工具" @click.stop="toggleBoneTools">以骨骼模式使用</button><button v-if="boneToolsEnabled" class="bone-visibility-toggle" :class="{ active: showContainerBones }" :aria-pressed="showContainerBones" :disabled="!hasOpenDocument" aria-label="显示骨骼" title="显示或隐藏所有容器的方向骨骼，不改变箭头长度" @click.stop="showContainerBones = !showContainerBones"><EditorIcon :name="showContainerBones ? 'eye' : 'eye-off'" :size="14" />显示骨骼</button><span class="workspace-hint">拖动控件 · 滚轮缩放 · 中键平移</span><span class="canvas-ratio">{{ customCanvasLabel || currentPreset.ratio }}</span></div>
        <div ref="viewportElement" class="viewport" :class="[{ 'is-panning': isPanning, 'is-creating-bones': boneCreateMode }, `tool-${canvasTool}`]" @pointermove="updateBoneHover" @pointerleave="clearBoneHover" @pointercancel="clearBoneHover" @wheel.prevent="handleCanvasWheel" @pointerdown.capture="captureBonePointer" @pointerdown="handleViewportPointerDown" @auxclick.prevent>
          <div class="canvas-stage" :class="{ 'mobile-frame': isMobilePreview }" :style="stageStyle">
            <div class="device-preview-label">{{ currentDevice.label }} · {{ formatDimension(canvasWidth) }} × {{ formatDimension(canvasHeight) }}</div>
            <div class="safe-area"></div>
            <div v-for="node in renderNodes" :key="node.id" class="canvas-node" :class="[`type-${node.type}`, { selected: node.id === selectedId, locked: node.locked, 'bone-attach-hover': node.id === boneHoverTarget?.id }]" :style="nodeStyle(node)" @pointerdown.stop="startCanvasPress($event)">
              <SpriteImage v-if="node.type === 'image'" :mask-properties="(previewNode(node) as UINodeOf<'image'>).properties" :asset="getImageAsset(node.properties.imageId)" :width="previewNode(node).width" :height="previewNode(node).height" :image-type="node.properties.imageType" :color="safeColor((previewNode(node) as UINodeOf<'image'>).properties.imageColor, editorTypeColors.image)" />
              <PrimitiveImage v-else-if="node.type === 'primitive'" :image-url="primitiveResourceById.get(node.properties.imageResourceId ?? '')?.imageUrl ?? ''" :preview-mode="node.properties.previewMode" :fit-data="primitiveResourceById.get(node.properties.imageResourceId ?? '')?.fitData" :width="previewNode(node).width" :height="previewNode(node).height" />
              <ControlTemplatePreview v-else-if="node.type === 'reference'" :asset="controlTemplateByIndex.get(node.properties.referencedPrefabIndex ?? -1) ?? null" :missing-index="node.properties.referencedPrefabIndex" :device-index="templateDeviceIndex" :width="previewNode(node).width" :height="previewNode(node).height" />
              <span v-else-if="node.type === 'text' || node.type === 'textWindow'" class="text-preview" :style="textRenderStyle(node)">{{ node.properties.text || node.name }}</span>
              <span v-else-if="node.type !== 'container'" class="generic-control-preview"><b>{{ nodeIcon(node.type) }}</b><small>{{ controlLabels[node.type] }}</small></span>
              <div v-if="node.id === selectedId" class="selection-tag">{{ node.name }} · {{ Math.round(previewNode(node).width) }} × {{ Math.round(previewNode(node).height) }}</div>
              <template v-if="node.id === selectedId">
                <template v-if="canvasTool === 'combined' && !boneCreateMode"><i v-for="corner in resizeCorners" :key="corner" class="selection-corner" :class="[`corner-${corner}`, { 'resize-handle': !node.locked }]" @pointerdown.stop="startResize($event, node, corner)"></i></template>
                <i class="selection-pivot" :style="{ left: `${previewNode(node).pivotX * 100}%`, bottom: `${previewNode(node).pivotY * 100}%` }"></i>
              </template>
            </div>
            <template v-if="boneToolsEnabled">
            <ContainerDirectionGuide v-for="guide in renderContainerDirections" :key="guide.id" :data-node-id="guide.id" :length="guide.length" :selected="guide.id === selectedId" :style="guide.style" />
            </template>
            <ContainerDirectionGuide v-if="boneDraftGuide" class="bone-draft" :length="boneDraftGuide.length" :selected="true" :style="boneDraftGuide.style" />
          </div>
          <span v-if="boneRootPoint" class="bone-root-point" :style="boneRootPoint" title="根容器 Pivot" aria-label="根容器中心点"></span>
          <div v-if="boneCreateMode" class="bone-create-hint" role="status">父级：{{ boneParent?.name }} · {{ boneHoverTarget ? `待归入：${boneHoverTarget.name} · Ctrl 点击确认` : '拖拽创建 · 单击骨骼换父级 · Ctrl 点击控件归入' }} · Esc 退出</div>
          <div v-if="transformGizmo && selectedNode" class="transform-gizmo" :style="transformGizmo.style">
            <template v-if="canvasTool === 'combined'">
              <svg class="transform-gizmo-lines" width="1" height="1" aria-hidden="true"><line :x1="transformGizmo.top.x" :y1="transformGizmo.top.y" :x2="transformGizmo.rotationHandle.x" :y2="transformGizmo.rotationHandle.y" /></svg>
              <button class="rotation-handle" :style="{ left: `${transformGizmo.rotationHandle.x}px`, top: `${transformGizmo.rotationHandle.y}px` }" aria-label="旋转选中控件" title="拖动旋转控件" @pointerdown.stop="startCanvasRotation($event, selectedNode)"><EditorIcon name="rotate" :size="17" /></button>
            </template>
            <svg v-else-if="canvasTool === 'rotate'" class="rotation-gizmo" width="116" height="116" viewBox="-58 -58 116 116" aria-label="旋转圆环：拖动圆环或控件旋转">
              <circle class="rotation-ring-hit" r="44" @pointerdown.stop="startCanvasRotation($event, selectedNode)" />
              <circle class="rotation-ring" r="44" />
              <path class="rotation-ticks" d="M0 -49v10M49 0H39M0 49V39M-49 0h10" />
              <line class="rotation-radius" x1="0" y1="0" :x2="transformGizmo.xAxis.x * 44 / 58" :y2="transformGizmo.xAxis.y * 44 / 58" />
              <circle class="rotation-center" r="4" />
            </svg>
            <svg v-else-if="canvasTool === 'scale'" class="scale-gizmo" width="1" height="1" aria-label="缩放手柄：中心等比缩放，红色 X 轴和绿色 Y 轴单独缩放">
              <g v-for="axis in transformGizmo.scaleAxes" :key="axis.id" :class="`scale-axis axis-${axis.id}`" @pointerdown.stop="startCanvasScale($event, selectedNode, axis.id)">
                <line class="scale-axis-hit" x1="0" y1="0" :x2="axis.x" :y2="axis.y" />
                <line x1="0" y1="0" :x2="axis.x" :y2="axis.y" />
                <rect :x="axis.x - 5" :y="axis.y - 5" width="10" height="10" rx="1" />
                <text :x="axis.x + 9" :y="axis.y + 4">{{ axis.id.toUpperCase() }}</text>
              </g>
              <rect class="scale-uniform" x="-6" y="-6" width="12" height="12" rx="2" @pointerdown.stop="startCanvasScale($event, selectedNode)" />
            </svg>
          </div>
          <button v-if="boneToolsEnabled && boneLengthHandle" class="bone-length-handle" :style="boneLengthHandle" aria-label="调整骨骼长度" :title="`拖动尖端调整骨骼长度 · ${selectedDirectionArrowLength} px`" @pointerdown.stop="startBoneLengthDrag"></button>
          <div class="viewport-status"><span>{{ currentDevice.label }}</span><span>{{ formatDimension(canvasWidth) }} × {{ formatDimension(canvasHeight) }}</span><span>X {{ cursorPosition.x }} &nbsp; Y {{ cursorPosition.y }}</span></div>
        </div>
        <div class="canvas-transform-toolbar" role="toolbar" aria-label="画布变换工具" @pointerdown.stop>
          <button v-for="tool in canvasTools" :key="tool.id" :class="{ active: canvasTool === tool.id }" :aria-pressed="canvasTool === tool.id" :title="tool.hint" @click="selectCanvasTool(tool.id)"><EditorIcon :name="tool.icon" :size="16" />{{ tool.label }}</button>
          <span class="canvas-transform-hint">{{ activeCanvasTool.hint }}</span>
        </div>
      </main>

      <AnimationListPanel :animations="animations" :selected-id="activeAnimationId" :disabled="!hasOpenDocument" :notice="animationNotice" :collapsed="animationsPanelCollapsed" @toggle-collapse="animationsPanelCollapsed = !animationsPanelCollapsed"
        @select="selectAnimation" @create="createAnimation" @duplicate="duplicateAnimation" @rename="renameAnimation" @remove="removeAnimation" />
      <aside class="inspector-panel panel">
        <div class="panel-heading inspector-heading">
          <div v-if="selectedNode" class="inspector-identity"><input v-model="selectedNode.name" class="inspector-name" aria-label="控件名称" /><span>{{ controlLabels[selectedNode.type] }}<span class="identity-separator">·</span>控件详情</span></div>
          <h2 v-else>控件详情</h2>
          <EditorIcon name="sliders" :size="20" />
        </div>
        <div v-if="selectedNode" class="inspector-tabs" role="tablist" aria-label="控件属性页签"><button id="inspector-basic-tab" role="tab" :aria-selected="inspectorTab === 'basic'" aria-controls="inspector-basic" :class="{ active: inspectorTab === 'basic' }" @click="inspectorTab = 'basic'" @keydown.right.prevent="switchInspectorTab('runtime')">基础</button><button id="inspector-runtime-tab" role="tab" :aria-selected="inspectorTab === 'runtime'" aria-controls="inspector-runtime" :class="{ active: inspectorTab === 'runtime' }" @click="inspectorTab = 'runtime'" @keydown.left.prevent="switchInspectorTab('basic')">运行时</button></div>
        <div v-if="selectedNode" class="inspector-scroll">
          <div v-if="propertyActionFeedback?.nodeId === selectedId" class="property-action-feedback" role="status">{{ propertyActionFeedback.message }}</div>
          <div v-show="inspectorTab === 'basic'" id="inspector-basic" role="tabpanel" aria-labelledby="inspector-basic-tab">
          <PropertySection title="变换" icon="⌖" group="transform">
            <div class="device-field"><span>设备</span><div class="device-mode-switch" role="group" aria-label="预览设备"><button v-for="device in deviceModes" :key="device.id" :class="{ active: deviceMode === device.id }" :title="device.label" :aria-label="device.label" :aria-pressed="deviceMode === device.id" @click.stop="switchDevice(device.id)"><DevicePreviewIcon :mode="device.id" :size="22" /></button></div></div>
            <div class="coordinate-note"><span title="坐标以画布左下角为原点">世界坐标 · 左下原点</span></div>
            <div class="property-grid">
              <NumberField :model-value="selectedWorldPosition.x" :animated="hasAnimatedField('anchoredPositionX')" axis="X" label="预览位置" @update:model-value="updateGeometry('x', $event)" />
              <NumberField :model-value="selectedWorldPosition.y" :animated="hasAnimatedField('anchoredPositionY')" axis="Y" @update:model-value="updateGeometry('y', $event)" />
              <NumberField :model-value="inspectorNode!.width" :animated="hasAnimatedField('sizeDeltaX')" axis="W" label="大小" :min="1" @update:model-value="updateGeometry('width', $event)" />
              <NumberField :model-value="inspectorNode!.height" :animated="hasAnimatedField('sizeDeltaY')" axis="H" :min="1" @update:model-value="updateGeometry('height', $event)" />
              <NumberField :model-value="inspectorNode!.scaleX" :animated="hasAnimatedField('localScaleX')" @update:model-value="updateAnimatedBaseValue('localScaleX', $event)" axis="X" label="缩放比例" :step="0.01" :scrub-speed="0.01" />
              <NumberField :model-value="inspectorNode!.scaleY" :animated="hasAnimatedField('localScaleY')" @update:model-value="updateAnimatedBaseValue('localScaleY', $event)" axis="Y" :step="0.01" :scrub-speed="0.01" />
              <NumberField :model-value="normalizeRotationAngle(inspectorNode!.rotation)" :min="-180" :max="180" :animated="hasAnimatedField('localRotationZ')" @update:model-value="updateAnimatedBaseValue('localRotationZ', $event)" class="full-width-number" axis="Z" label="旋转" />
            </div>
            <details class="secondary-transform"><summary>更多变换（3D）</summary><div class="property-grid">
              <NumberField :model-value="inspectorNode!.scaleZ" :animated="hasAnimatedField('localScaleZ')" @update:model-value="updateAnimatedBaseValue('localScaleZ', $event)" axis="Z" label="缩放 Z" :step="0.01" :scrub-speed="0.01" /><span></span>
              <NumberField :model-value="normalizeRotationAngle(inspectorNode!.rotationX)" :min="-180" :max="180" :animated="hasAnimatedField('localRotationX')" @update:model-value="updateAnimatedBaseValue('localRotationX', $event)" axis="X" label="旋转 XY" />
              <NumberField :model-value="normalizeRotationAngle(inspectorNode!.rotationY)" :min="-180" :max="180" :animated="hasAnimatedField('localRotationY')" @update:model-value="updateAnimatedBaseValue('localRotationY', $event)" axis="Y" />
            </div></details>
            <div class="anchor-type-row">
              <label><span>锚点类型</span><select :value="currentAnchorPresetId" @change="onAnchorPresetSelect"><option value="custom">自定义</option><option v-for="preset in anchorPresets" :key="preset.id" :value="preset.id">{{ preset.label }}</option></select></label>
              <div class="anchor-picker-wrap">
                <button class="anchor-preview-button" title="选择锚点预设" :aria-expanded="anchorMenuOpen" @pointerdown.stop @click.stop="toggleAnchorPopover($event)"><AnchorVisual :values="inspectorNode!" /></button>
                <Teleport to="body">
                  <div v-if="anchorMenuOpen" class="anchor-popover-overlay" @pointerdown.self.stop="anchorMenuOpen = false" @click.stop @keydown.esc.stop="anchorMenuOpen = false">
                    <div class="anchor-preset-popover" :style="anchorPopoverStyle" role="dialog" aria-label="锚点预设" @pointerdown.stop>
                      <button v-for="preset in anchorPresets" :key="preset.id" :title="preset.label" :aria-label="preset.label" :class="{ active: preset.id === currentAnchorPresetId }" @click="applyAnchorPreset(preset.id)"><AnchorVisual :values="preset" /></button>
                    </div>
                  </div>
                </Teleport>
              </div>
            </div>
            <div class="anchor-values">
              <div class="anchor-values-title"><span>锚点设置</span><small>左下 0,0 · 右上 1,1</small></div>
              <div class="property-grid"><NumberField :model-value="inspectorNode!.anchorMinX" :animated="hasAnimatedField('anchorMinX')" axis="X" label="Min" :step="0.01" :min="0" :max="1" @update:model-value="updateAnchor('min', 'x', $event)" /><NumberField :model-value="inspectorNode!.anchorMinY" :animated="hasAnimatedField('anchorMinY')" axis="Y" :step="0.01" :min="0" :max="1" @update:model-value="updateAnchor('min', 'y', $event)" /><NumberField :model-value="inspectorNode!.anchorMaxX" :animated="hasAnimatedField('anchorMaxX')" axis="X" label="Max" :step="0.01" :min="0" :max="1" @update:model-value="updateAnchor('max', 'x', $event)" /><NumberField :model-value="inspectorNode!.anchorMaxY" :animated="hasAnimatedField('anchorMaxY')" axis="Y" :step="0.01" :min="0" :max="1" @update:model-value="updateAnchor('max', 'y', $event)" /><NumberField :model-value="inspectorNode!.pivotX" :animated="hasAnimatedField('pivotX')" axis="X" label="中心" :step="0.01" :min="0" :max="1" @update:model-value="updatePivot('x', $event)" /><NumberField :model-value="inspectorNode!.pivotY" :animated="hasAnimatedField('pivotY')" axis="Y" :step="0.01" :min="0" :max="1" @update:model-value="updatePivot('y', $event)" /></div>
            </div>
          </PropertySection>
          <PropertySection v-if="selectedNode.type === 'image'" title="图片设置" icon="▧" group="image">
            <ImageControlSettings :model-value="(inspectorNode as UINodeOf<'image'>).properties" :asset="selectedImageAsset" :animated="hasAnimatedField('imageColor')" @update:model-value="selectedProperties = $event" @select="selectImageAsset" @open-library="imageLibraryOpen = true" @reset-size="resetSelectedImageSize" />
          </PropertySection>
          <ControlPropertiesInspector :key="selectedId ?? ''" v-model="selectedProperties" :definition="selectedInspectorDefinition" :animated-fields="animatedPropertyFields">
            <template #field-imageResourceId>
              <div v-if="selectedNode?.type === 'primitive'" class="primitive-resource-reference">
                <button class="template-reference-picker" aria-label="选择图元图片资源" @click.stop="openPrimitiveResourceLibrary">{{ selectedPrimitiveResource?.name ?? '未选择图片资源' }} <span>选择资源…</span></button>
                <div class="primitive-display-mode"><button :aria-pressed="selectedNode.properties.previewMode !== 'primitives'" @click="selectedProperties = { ...selectedProperties, previewMode: 'image' }">原图</button><button :disabled="!selectedPrimitiveResource?.fitData" :aria-pressed="selectedNode.properties.previewMode === 'primitives'" @click="selectedProperties = { ...selectedProperties, previewMode: 'primitives' }">游戏图元</button><button v-if="selectedNode.properties.imageResourceId" @click="selectedProperties = { ...selectedProperties, imageResourceId: null, previewMode: 'image' }">解除引用</button></div>
                <small v-if="selectedPrimitiveResource">{{ selectedPrimitiveResource.fitData ? `${selectedPrimitiveResource.fitData.elements.length} 个图元 · 共用资源拟合结果` : '尚未生成图元，请在图片资源面板中设置拟合。' }}</small>
              </div>
            </template>
            <template #field-referencedPrefabIndex>
              <button class="template-reference-picker" aria-label="引用预制索引" @click.stop="openControlTemplateLibrary">{{ selectedControlTemplateLabel }} <span>选择模板…</span></button>
              <button v-if="selectedControlTemplate" class="template-original-size" @click="resetControlTemplateSize">恢复模板原始尺寸</button>
            </template>
            <template #actions><PropertyActionsMenu :label="`${selectedControlDefinition.label}参数`" :context-key="`${selectedId}:${inspectorTab}`" :can-paste="canPasteSelectedPropertyGroup('control')" :paste-hint="propertyPasteHint('control')" @reset="resetSelectedPropertyGroup('control')" @copy="copySelectedPropertyGroup('control')" @paste="pasteSelectedPropertyGroup('control')" /></template>
          </ControlPropertiesInspector>
          <PropertySection title="创建设置" group="creation">
            <label class="setting-switch"><span>初始激活</span><input v-model="selectedNode.active" type="checkbox" role="switch" /></label>
            <label class="setting-switch"><span>初始可见性</span><input v-model="selectedNode.visible" type="checkbox" role="switch" /></label>
          </PropertySection>
          <PropertySection title="编辑设置" group="editor">
            <label class="setting-switch"><span>锁定控件</span><input v-model="selectedNode.locked" type="checkbox" role="switch" /></label>
            <label class="setting-switch"><span>允许手柄聚焦</span><input v-model="selectedNode.canControllerFocus" type="checkbox" role="switch" /></label>
          </PropertySection>
          <PropertySection v-if="boneToolsEnabled && selectedNode.type === 'container'" title="方向标识">
            <label class="direction-length-field"><span>骨骼长度</span><ScrubbableNumberInput :model-value="selectedDirectionArrowLength" :min="0" :max="MAX_DIRECTION_ARROW_LENGTH" :step="1" :scrub-speed="1" aria-label="方向箭头长度" @update:model-value="updateDirectionArrowLength" /><i>px</i></label>
            <p class="direction-guide-note">拖动骨骼尖端调整长度 · 0 隐藏<br />仅为编辑辅助，不影响控件大小或 Lua 导出。</p>
          </PropertySection>
          </div>
          <div v-show="inspectorTab === 'runtime'" id="inspector-runtime" role="tabpanel" aria-labelledby="inspector-runtime-tab">
            <div class="runtime-heading"><b>{{ selectedControlDefinition.runtimeClass }}</b><span>查看和编辑用于 Lua / Tween 的布局原值</span></div>
            <PropertySection title="布局与锚点" group="transform">
              <p class="api-layout-note">anchoredPosition 是控件中心点相对锚点参考位置的偏移；拉伸锚点按中心值在 Min 与 Max 间计算参考位置。无父级时锚点以画布为参照。</p>
              <div class="api-layout-grid">
                <label><code>anchoredPositionX</code><ScrubbableNumberInput :model-value="selectedRuntimeLayoutValues.anchoredPositionX" :animated="hasAnimatedField('anchoredPositionX')" :step="0.01" :scrub-speed="1" @update:model-value="updateRuntimeLayoutValue('anchoredPositionX', $event)" /></label>
                <label><code>anchoredPositionY</code><ScrubbableNumberInput :model-value="selectedRuntimeLayoutValues.anchoredPositionY" :animated="hasAnimatedField('anchoredPositionY')" :step="0.01" :scrub-speed="1" @update:model-value="updateRuntimeLayoutValue('anchoredPositionY', $event)" /></label>
                <label><code>sizeDeltaX</code><ScrubbableNumberInput :model-value="selectedRuntimeLayoutValues.sizeDeltaX" :animated="hasAnimatedField('sizeDeltaX')" :step="0.01" :scrub-speed="1" @update:model-value="updateRuntimeLayoutValue('sizeDeltaX', $event)" /></label>
                <label><code>sizeDeltaY</code><ScrubbableNumberInput :model-value="selectedRuntimeLayoutValues.sizeDeltaY" :animated="hasAnimatedField('sizeDeltaY')" :step="0.01" :scrub-speed="1" @update:model-value="updateRuntimeLayoutValue('sizeDeltaY', $event)" /></label>
              </div>
              <div class="api-tween-readout"><div v-for="item in selectedAdditionalRuntimeTweenValues" :key="item.key"><code>{{ item.key }}</code><b>{{ formatDimension(item.value) }}</b></div></div>
            </PropertySection>
          </div>
        </div>
        <div v-else class="inspector-empty"><div>⌖</div><p>选择画布或层级中的控件</p><span>随后可以在这里编辑它的参数</span></div>
      </aside>
    </div>

    <section ref="timelinePanel" class="timeline-panel keyframe-panel">
      <div class="timeline-resize-handle" role="separator" aria-label="调整时间轴高度" aria-orientation="horizontal" :aria-valuemin="MIN_TIMELINE_HEIGHT" :aria-valuemax="timelineMaximumHeight" :aria-valuenow="Math.round(resolvedTimelineHeight)" tabindex="0" title="上下拖动调整时间轴高度 · 双击恢复自动高度" @pointerdown.stop="startTimelineResize" @dblclick.stop="resetTimelineHeight" @keydown.up.prevent="nudgeTimelineHeight(16)" @keydown.down.prevent="nudgeTimelineHeight(-16)"><span></span></div>
      <KeyframeTimeline :key="`${keyframeDocumentEpoch}:${activeAnimationId}`" :nodes="timelineNodes" :tracks="keyframeTracks" :selected-node-id="selectedId" :selected-keyframe-id="selectedKeyframeId" :current-time="currentTime" :duration="duration" :playing="playing" :snap-enabled="timelineSnapEnabled" :animation-name="activeAnimation.name" :frame-rate="frameRate" @update-frame-rate="frameRate = $event"
        :track-values="timelineTrackValues" @edit-track-value="editTimelineTrackValue"
        @select-node="selectKeyframeNode" @select-track="selectKeyframeTrack" @add-track="openKeyframeFieldPicker" @select-keyframe="selectKeyframe"
        @seek="seekKeyframeTime" @update-duration="updateKeyframeDuration" @toggle-play="togglePlayback" @toggle-snap="toggleTimelineSnapping" @rewind="rewindPlayback"
        @upsert-keyframe="insertKeyframeAtTime" @move-keyframe="moveKeyframe" @update-keyframe="updateKeyframe"
        @remove-keyframe="removeKeyframe" @remove-track="removeKeyframeTrack"
        @begin-edit="editorHistory.begin('keyframe')" @end-edit="editorHistory.end('keyframe')">
        <template #events><EventTimeline :events="activeAnimation.events ?? []" :nodes="nodes" :duration="duration" :current-time="currentTime" :snap-enabled="timelineSnapEnabled" :snap-times="keyframeTracks.flatMap(t => t.keyframes.map(k => k.time))" :logs="eventPreviewLog"
          @change="updateTimelineEvents" @begin-edit="playing = false; editorHistory.begin('events')" @end-edit="editorHistory.end('events')" @select="playing = false" @clear-log="eventPreviewLog = []" /></template>
      </KeyframeTimeline>
      <p v-if="timelineEditNotice" class="keyframe-notice" role="status">{{ timelineEditNotice }}</p>
    </section>

    <TimelineContextMenu :target="timelineContextMenu" @create="createTimelineContextClip" @delete-clip="deleteTimelineContextClip" @delete="deleteTimelineContextTrack" @close="closeTimelineContextMenu" />
    <TimelineDataImportDialog v-if="timelineDataImportOpen" v-model:source-text="timelineDataSource" v-model:root-id="timelineDataRootId" v-model:mode="timelineDataImportMode" :roots="timelineDataRootOptions" :preview="timelineDataImportSummary" @confirm="confirmTimelineDataImport" @close="timelineDataImportOpen = false" />

    <div v-if="archive && !hasOpenDocument" class="document-empty-state">
      <h2>{{ archive.ready.value ? '选择或创建编辑文件' : '正在加载工作区' }}</h2>
      <p>{{ archive.error.value || '工作区保存控件层级、参数和 Timeline。导入 GIA 会新建文件，不覆盖原有内容。' }}</p>
      <button @click="workspacePanelOpen = true">打开工作区</button>
    </div>
    <ClientUIWorkspacePanel v-if="archive" :open="workspacePanelOpen" :busy="archive.busy.value"
      :workspaces="archive.workspaceIds.value" :documents="archive.documentNames.value"
      :workspace="archive.selectedWorkspace.value" :document="archive.selectedDocument.value"
      :status="archive.status.value" :error="archive.error.value"
      @close="workspacePanelOpen = false"
      @select-workspace="runArchiveAction(() => archive!.switchWorkspace($event))"
      @select-document="openWorkspaceDocument"
      @create-workspace="createWorkspace" @rename-workspace="renameWorkspace" @delete-workspace="deleteWorkspace"
      @create-document="resetProject" @rename-document="renameWorkspaceDocument" @delete-document="deleteWorkspaceDocument"
      @import-gia="openGiaFile" @import-json="openProject" @retry="retryArchive" />
    <button v-if="archive?.canUndoDelete.value && !workspacePanelOpen" class="archive-undo" @click.stop="runArchiveAction(() => archive!.undoDelete())">已移至回收站 · 撤销删除</button>
    <ClientUIArchiveActionDialog v-if="archiveAction" :title="archiveAction.title" :message="archiveAction.message"
      :mode="archiveAction.mode" :initial-value="archiveAction.initialValue" :busy="archive?.busy.value ?? false"
      :error="archive?.error.value ?? ''" @cancel="archiveAction = null" @submit="confirmArchiveAction" />

    <div v-if="tweenFieldPickerNode" class="tween-field-picker-backdrop" tabindex="-1" @pointerdown.self.stop="closeTweenFieldPicker" @keydown.esc.stop="closeTweenFieldPicker">
      <section class="tween-field-picker" role="dialog" aria-modal="true" aria-labelledby="tween-field-picker-title" @pointerdown.stop>
        <header class="tween-field-picker-header">
          <div class="tween-field-picker-icon"><EditorIcon :name="controlIconName(tweenFieldPickerNode.type)" :size="21" /></div>
          <div class="tween-field-picker-heading"><h2 id="tween-field-picker-title">添加参数</h2><p :title="`${tweenFieldPickerNode.name} · ${selectedTweenPickerDefinition.runtimeClass}`">{{ tweenFieldPickerNode.name }}<span>·</span>{{ selectedTweenPickerDefinition.label }}</p></div>
          <button title="关闭参数选择" aria-label="关闭参数选择" @click="closeTweenFieldPicker">×</button>
        </header>
        <div class="tween-field-picker-search"><EditorIcon name="search" :size="17" /><input v-model="tweenFieldSearch" autofocus aria-label="搜索动画参数" placeholder="搜索参数名称或字段名" /><button v-if="tweenFieldSearch" type="button" aria-label="清空参数搜索" @click="tweenFieldSearch = ''">×</button></div>
        <div class="tween-field-picker-content">
          <section v-if="tweenFieldPickerCombos.length" class="tween-field-picker-group">
            <header><div><b>组合添加</b><small>一次添加 X、Y 两条独立轨道，已有轨道保持不变</small></div></header>
            <div class="tween-field-picker-grid">
              <button v-for="combo in tweenFieldPickerCombos" :key="combo.label" @click="addKeyframeTrackPair(tweenFieldPickerNode, combo.fields)">
                <span class="parameter-kind">XY</span><b>{{ combo.label }}</b>
                <code>{{ combo.fields.join(' + ') }}</code>
                <EditorIcon class="parameter-add" name="plus" :size="17" />
                <small>添加缺少的轴 · 可分别编辑</small>
              </button>
            </div>
          </section>
          <section v-for="group in tweenFieldPickerGroups" :key="group.key" class="tween-field-picker-group">
            <header><div><b>{{ group.title }}</b><small>{{ group.description }}</small></div><em>{{ group.fields.length }} 项</em></header>
            <div class="tween-field-picker-grid">
              <button v-for="field in group.fields" :key="field.fieldKey" :disabled="Boolean(tweenFieldConflict(tweenFieldPickerNode, field.fieldKey))" :title="tweenFieldConflict(tweenFieldPickerNode, field.fieldKey) ?? field.description" @click="addKeyframeTrack(tweenFieldPickerNode, field.fieldKey)">
                <span class="parameter-kind" :class="`kind-${field.valueKind}`">{{ field.valueKind === 'boolean' ? '显隐' : field.valueKind === 'color' ? '颜色' : '数值' }}</span>
                <b>{{ field.label }}</b>
                <code>{{ field.fieldKey }}</code>
                <EditorIcon class="parameter-add" name="plus" :size="17" />
                <small v-if="tweenFieldConflict(tweenFieldPickerNode, field.fieldKey) || field.source === 'group'">{{ tweenFieldConflict(tweenFieldPickerNode, field.fieldKey) ? '已有颜色轨道冲突（悬停查看）' : '组合动画 · 0–255 · 基础 Alpha 相乘' }}</small>
              </button>
            </div>
          </section>
          <div v-if="tweenFieldPickerGroups.length === 0 && tweenFieldPickerCombos.length === 0" class="tween-field-picker-empty"><EditorIcon :name="tweenFieldSearch ? 'search' : 'timeline'" :size="28" /><b>{{ tweenFieldSearch ? '没有匹配的参数' : '所有可用参数都已添加' }}</b><span>{{ tweenFieldSearch ? '试试其他名称，或清空搜索。' : '关闭窗口后可直接编辑已有轨道。' }}</span></div>
        </div>
        <footer><span>选择参数以创建动画轨道</span><button @click="closeTweenFieldPicker">完成</button></footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { toast } from "vue-sonner";
import type { StorageClass } from "@/services/storage/storage";
import ClientUIWorkspacePanel from "./ClientUIWorkspacePanel.vue";
import ClientUIArchiveActionDialog from "./ClientUIArchiveActionDialog.vue";
import { ClientUIWorkspaceRepository } from "./workspaceStorage";
import { useClientUIWorkspace } from "./useClientUIWorkspace";
import type { CSSProperties, PropType } from "vue";
import ColorRGBAField from "./ColorRGBAField.vue";
import EditorIcon from "./EditorIcon.vue";
import DevicePreviewIcon from "./DevicePreviewIcon.vue";
import PreviewPresetSelect from "./PreviewPresetSelect.vue";
import PropertyActionsMenu from "./PropertyActionsMenu.vue";
import TimelineContextMenu from "./TimelineContextMenu.vue";
import TimelineDataImportDialog from "./TimelineDataImportDialog.vue";
import ContainerDirectionGuide from "./ContainerDirectionGuide.vue";
import EditorHistoryPanel from "./EditorHistoryPanel.vue";
import KeyframeTimeline from "./KeyframeTimeline.vue";
import EventTimeline from "./EventTimeline.vue";
import { normalizeTimelineEvents, crossedTimelineEvents } from "./timelineEvents";
import type { UITimelineEvent } from "./types";
import type { UIAnimation, UIKeyframe, UIKeyframeTrack } from "./types";
import AnimationListPanel from "./AnimationListPanel.vue";
import { normalizeAnimationCollection, uniqueAnimationName } from "./animationCollection";
import { removeRetiredScaleTweenTracks } from "./timelineCompatibility";
import { evaluateKeyframeTrack, resolveKeyframeTrack, migrateTweenClipsToKeyframes, normalizeKeyframeTracks } from "./keyframeTimeline";
import { buildKeyframeTimelineDataLua, prepareKeyframeTimelineImport } from "./keyframeLua";
import { createEditorHistory } from "./editorHistory";
import { describeHistoryChange } from "./historyChangeLabel";
import { MAX_DIRECTION_ARROW_LENGTH, normalizeDirectionArrowLength, containerDirectionGuideStyle } from "./containerDirectionGuide";
import { boneGeometry, boneAttachmentTransform, distanceToBone, BONE_THICKNESS, type BonePoint } from "./boneCreation";
import { prepareTweenTimelineImport } from "./luaTweenImporter";
import type { TimelineDataImportMode } from "./luaTweenImporter";
import { capturePropertyGroup, canPastePropertyGroup, pastePropertyGroup, resetPropertyGroup } from "./propertyGroupActions";
import type { PropertyGroup, PropertyGroupSnapshot } from "./propertyGroupActions";
import ControlPropertiesInspector from "./ControlPropertiesInspector.vue";
import ScrubbableNumberInput from "./ScrubbableNumberInput.vue";
import { controlDefinitions, controlRegistry, createControlProperties, getControlDefinition } from "./controlRegistry";
import { importGiaControls } from "./giaImporter";
import { exportGiaUI, normalizeGiaExportSource, originalGiaUIIndex, createGiaExportBaseline, type GiaExportSource } from "./giaExporter";
import GiaExportDialog from "./GiaExportDialog.vue";
import PrimitiveImage from "./PrimitiveImage.vue";
import { normalizePrimitiveProperties } from "./primitiveData";
import { migratePrimitiveResources, normalizePrimitiveResources, type PrimitiveImageResource } from "./primitiveResources";
import PrimitiveResourceLibrary from "./PrimitiveResourceLibrary.vue";
import { buildPrimitiveProjectLua } from "./primitiveLuaExporter";
import { buildPrimitiveImageLibLua } from "./primitiveLuaRuntime";
import { buildTemplateScene, normalizeControlTemplates, templateIndexError, type ControlTemplateAsset } from "./controlTemplates";
import ControlTemplateLibrary from "./ControlTemplateLibrary.vue";
import ControlTemplatePreview from "./ControlTemplatePreview.vue";
import { imageAssetById, loadImageCatalog, loadSpriteMetadata } from "./imageAssets";
import { isStretchable } from "./spriteGeometry";
import ImageControlSettings from "./ImageControlSettings.vue";
import ImageAssetLibrary from "./ImageAssetLibrary.vue";
import SpriteImage from "./SpriteImage.vue";
import { buildTweenTimelineDataLua, buildTweenTimelineLibLua, TWEEN_TIMELINE_LIB_VERSION } from "./luaTweenExporter";
import { applyTweenEase, getTweenableField, getTweenableFields, getGroupAlphaColorFields, getTweenGroupNodes, getTweenTrackConflict, getTweenRelativeLabel, GROUP_ALPHA_FIELD_KEY, GROUP_ALPHA_MAX, isRelativeTweenField, isTweenEaseType, tweenEaseOptions } from "./tweenRegistry";
import { snapTweenClip } from "./timelineSnapping";
import { getTweenClipGap, getTweenClipBounds, tweenClipsOverlap, orderTweenClips, TWEEN_CLIP_TIME_EPSILON } from "./timelineClipLayout";
import type { TweenClipSnapMode } from "./timelineSnapping";
import type { TweenableFieldDefinition } from "./tweenRegistry";
import type { ClientUIBaseControlModel, ColorRGBA, ControlPropertiesMap, ControlType, TweenEaseType, UITweenTrack, UITweenValue, UINode, UINodeOf, UINodeEditorSettings } from "./types";

const PropertySection = defineComponent({
  props: { title: { type: String, required: true }, icon: { type: String, default: "" }, group: { type: String as PropType<PropertyGroup | "">, default: "" } },
  setup(props, { slots }) {
    return () => h("details", { class: "property-section", open: true }, [
      h("summary", [h("span", { class: "section-chevron", "aria-hidden": "true" }, "▸"), props.title, props.group ? h(PropertyActionsMenu, {
        label: props.title,
        contextKey: `${selectedId.value}:${inspectorTab.value}`,
        canPaste: canPasteSelectedPropertyGroup(props.group),
        pasteHint: propertyPasteHint(props.group),
        onReset: () => { if (props.group) resetSelectedPropertyGroup(props.group); },
        onCopy: () => { if (props.group) copySelectedPropertyGroup(props.group); },
        onPaste: () => { if (props.group) pasteSelectedPropertyGroup(props.group); },
      }) : null]),
      h("div", { class: "property-section-body" }, slots.default?.()),
    ]);
  },
});
const inspectorTab = ref<"basic" | "runtime">("basic");
const propertyClipboard = ref<PropertyGroupSnapshot | null>(null);
const propertyActionFeedback = ref<{ nodeId: string; message: string } | null>(null);
function switchInspectorTab(tab: "basic" | "runtime") { inspectorTab.value = tab; nextTick(() => editorElement.value?.querySelector<HTMLButtonElement>(`#inspector-${tab}-tab`)?.focus()); }
function controlIconName(type: ControlType) { return type === "text" || type === "textWindow" ? "text" : type === "image" || type === "primitive" ? "image" : type === "gridScroller" ? "grid" : type === "uiAnimation" || type === "fullscreenAnimation" ? "timeline" : "container"; }
const NumberField = defineComponent({ props: { animated: { type: Boolean, default: false }, modelValue: { type: Number, required: true }, axis: { type: String, required: true }, label: { type: String, default: "" }, step: { type: Number, default: 1 }, min: { type: Number as PropType<number | undefined>, default: undefined }, max: { type: Number as PropType<number | undefined>, default: undefined }, scrubSpeed: { type: Number as PropType<number | undefined>, default: undefined } }, emits: ["update:modelValue"], setup(props, { emit }) { return () => h("label", { class: ["number-field", { "animated-number-field": props.animated }] }, [h("span", { class: "field-label" }, props.label), h("div", [h("b", { class: `axis axis-${props.axis.toLowerCase()}` }, props.axis), h(ScrubbableNumberInput, { modelValue: props.modelValue, animated: props.animated, step: props.step, min: props.min, max: props.max, scrubSpeed: props.scrubSpeed, "onUpdate:modelValue": (value: number | null) => { if (value !== null) emit("update:modelValue", value); } })])]); } });
type AnchorValues = Pick<UINode, "anchorMinX" | "anchorMinY" | "anchorMaxX" | "anchorMaxY" | "pivotX" | "pivotY">;
const AnchorVisual = defineComponent({ props: { values: { type: Object as PropType<AnchorValues>, required: true } }, setup(props) { return () => h("span", { class: "anchor-visual", style: anchorVisualStyle(props.values) }, [h("span", { class: "anchor-bounds" }), h("i", { class: "anchor-dot anchor-dot-bl" }), h("i", { class: "anchor-dot anchor-dot-br" }), h("i", { class: "anchor-dot anchor-dot-tl" }), h("i", { class: "anchor-dot anchor-dot-tr" }), h("b", { class: "pivot-mark" }, "✦")]); } });

const DEFAULT_CANVAS_WIDTH = 1600;
const DEFAULT_CANVAS_HEIGHT = 900;
const MIN_TIMELINE_HEIGHT = 150;
const MIN_EDITOR_BODY_HEIGHT = 260;
const EDITOR_TOOLBAR_HEIGHT = 48;
const editorTypeColors: Record<ControlType, ColorRGBA> = {
  primitive: colorFromHex("#b48cde"),
  container: colorFromHex("#39a6c8"), image: colorFromHex("#ffffff"), text: colorFromHex("#6d7cff"), textWindow: colorFromHex("#8b74e8"), presetButton: colorFromHex("#5f78ff"), cursorEventArea: colorFromHex("#e59b5a"), gridScroller: colorFromHex("#58b89c"), keyHint: colorFromHex("#d6b85f"), uiAnimation: colorFromHex("#d267e5"), fullscreenAnimation: colorFromHex("#e55f91"), reference: colorFromHex("#7893b8"),
};
const createId = () => `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const createTweenId = () => `tween_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const MIN_TWEEN_DURATION = 0.01;
const DEFAULT_TWEEN_DURATION = 1;
const TIMELINE_MODEL_VERSION = 10;
function colorFromHex(hex: string, alpha = 1): ColorRGBA { const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "ffffff"; return { r: Number.parseInt(normalized.slice(0, 2), 16), g: Number.parseInt(normalized.slice(2, 4), 16), b: Number.parseInt(normalized.slice(4, 6), 16), a: clamp01(alpha) }; }
function colorToCss(color: ColorRGBA, alphaMultiplier = 1) { return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${clamp01(color.a * alphaMultiplier)})`; }
type NodeOverrides<T extends ControlType> = Partial<ClientUIBaseControlModel> & { properties?: Partial<ControlPropertiesMap[T]>; editor?: UINodeEditorSettings | null };
function makeNode(type: "container", name: string, overrides?: NodeOverrides<"container">): UINodeOf<"container">;
function makeNode(type: "image", name: string, overrides?: NodeOverrides<"image">): UINodeOf<"image">;
function makeNode(type: "text", name: string, overrides?: NodeOverrides<"text">): UINodeOf<"text">;
function makeNode(type: ControlType, name: string, overrides?: NodeOverrides<ControlType>): UINode;
function makeNode(type: ControlType, name: string, overrides: NodeOverrides<ControlType> = {}): UINode {
  const definition = getControlDefinition(type);
  const { properties: propertyOverrides, editor: editorOverrides, ...baseOverrides } = overrides;
  const defaultWidth = definition.defaultWidth;
  const defaultHeight = definition.defaultHeight;
  const node = { id: createId(), parentId: null, name, type, active: true, x: DEFAULT_CANVAS_WIDTH / 2, y: DEFAULT_CANVAS_HEIGHT / 2, width: defaultWidth, height: defaultHeight, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotation: 0, anchorMinX: 0.5, anchorMinY: 0.5, anchorMaxX: 0.5, anchorMaxY: 0.5, pivotX: 0.5, pivotY: 0.5, anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: defaultWidth, sizeDeltaY: defaultHeight, canControllerFocus: false, visible: true, locked: false, properties: { ...createControlProperties(type), ...propertyOverrides }, ...baseOverrides } as UINode;
  if (type === "container") node.editor = { directionArrowLength: normalizeDirectionArrowLength(editorOverrides?.directionArrowLength) };
  if (node.type === "primitive") node.properties = normalizePrimitiveProperties(node.properties);
  if (node.type === "image" && node.properties.softEdgeMode !== "percentage") node.properties.softEdgeMode = "pixel";
  const anchorRefX = ((1 - node.pivotX) * node.anchorMinX + node.pivotX * node.anchorMaxX) * DEFAULT_CANVAS_WIDTH;
  const anchorRefY = ((1 - node.pivotY) * node.anchorMinY + node.pivotY * node.anchorMaxY) * DEFAULT_CANVAS_HEIGHT;
  if (!Number.isFinite(overrides.anchorOffsetX)) node.anchorOffsetX = node.x - anchorRefX;
  if (!Number.isFinite(overrides.anchorOffsetY)) node.anchorOffsetY = node.y - anchorRefY;
  if (!Number.isFinite(overrides.sizeDeltaX)) node.sizeDeltaX = node.width - (node.anchorMaxX - node.anchorMinX) * DEFAULT_CANVAS_WIDTH;
  if (!Number.isFinite(overrides.sizeDeltaY)) node.sizeDeltaY = node.height - (node.anchorMaxY - node.anchorMinY) * DEFAULT_CANVAS_HEIGHT;
  return node;
}
function makeRootContainer(width = DEFAULT_CANVAS_WIDTH, height = DEFAULT_CANVAS_HEIGHT, id = createId()) {
  return makeNode("container", "Default_UI", {
    id, x: width / 2, y: height / 2, width, height,
    anchorMinX: 0, anchorMinY: 0, anchorMaxX: 1, anchorMaxY: 1,
    anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 0, sizeDeltaY: 0,
  });
}
interface AnchorPreset extends AnchorValues { id: string; label: string }
const anchorXModes = [
  { id: "left", label: "左", min: 0, max: 0 },
  { id: "center", label: "中", min: 0.5, max: 0.5 },
  { id: "right", label: "右", min: 1, max: 1 },
  { id: "stretch", label: "横向拉伸", min: 0, max: 1 },
] as const;
const anchorYModes = [
  { id: "top", label: "上", min: 1, max: 1 },
  { id: "middle", label: "中", min: 0.5, max: 0.5 },
  { id: "bottom", label: "下", min: 0, max: 0 },
  { id: "stretch", label: "纵向拉伸", min: 0, max: 1 },
] as const;
const anchorPresetLabels: Record<string, string> = {
  "left-top": "左上", "center-top": "顶部", "right-top": "右上", "stretch-top": "顶部横向拉伸",
  "left-middle": "左侧", "center-middle": "中心", "right-middle": "右侧", "stretch-middle": "中部横向拉伸",
  "left-bottom": "左下", "center-bottom": "底部", "right-bottom": "右下", "stretch-bottom": "底部横向拉伸",
  "left-stretch": "左侧纵向拉伸", "center-stretch": "居中纵向拉伸", "right-stretch": "右侧纵向拉伸", "stretch-stretch": "双向拉伸",
};
const anchorPresets: AnchorPreset[] = anchorYModes.flatMap((vertical) => anchorXModes.map((horizontal) => ({ id: `${horizontal.id}-${vertical.id}`, label: anchorPresetLabels[`${horizontal.id}-${vertical.id}`], anchorMinX: horizontal.min, anchorMinY: vertical.min, anchorMaxX: horizontal.max, anchorMaxY: vertical.max, pivotX: 0.5, pivotY: 0.5 })));
const rootId = createId();
const nodes = ref<UINode[]>([
  makeRootContainer(DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT, rootId),
  makeNode("image", "Header_Background", { parentId: rootId, x: 560, y: 555, width: 1120, height: 130, properties: { imageId: 100001, imageColor: colorFromHex("#263d64") } }),
  makeNode("text", "Quest_Title", { parentId: rootId, x: 300, y: 560, width: 480, height: 64, properties: { text: "任务标题", fontSize: 30, fontColor: colorFromHex("#f3f6ff") } }),
  makeNode("image", "Action_Button", { parentId: rootId, x: 925, y: 105, width: 210, height: 72, properties: { imageId: 100001, imageColor: colorFromHex("#5f78ff") } }),
]);
type DeviceMode = "pc" | "mobile" | "controllerDesktop" | "controllerMobile";
interface PreviewPreset { id: string; ratio: string; width: number; height: number }
const deviceModes: Array<{ id: DeviceMode; label: string; shortLabel: string; icon: string }> = [
  { id: "pc", label: "PC", shortLabel: "PC", icon: "▱" },
  { id: "mobile", label: "移动端", shortLabel: "移动", icon: "▭" },
  { id: "controllerDesktop", label: "手柄（PC / 主机）", shortLabel: "手柄", icon: "⌘" },
  { id: "controllerMobile", label: "手柄（移动端）", shortLabel: "手柄·移动", icon: "⌘" },
];
const previewPresets: Record<DeviceMode, PreviewPreset[]> = {
  pc: [
    { id: "pc-16-9", ratio: "16:9", width: 1600, height: 900 },
    { id: "pc-21-9", ratio: "21:9", width: 2100, height: 900 },
  ],
  mobile: [
    { id: "mobile-16-9", ratio: "16:9", width: 1280, height: 720 },
    { id: "mobile-19_5-9", ratio: "19.5:9", width: 1560.43, height: 720 },
    { id: "mobile-4-3", ratio: "4:3", width: 1280, height: 959.53 },
  ],
  controllerDesktop: [
    { id: "controller-desktop-16-9", ratio: "16:9", width: 1920, height: 1080 },
    { id: "controller-desktop-21-9", ratio: "21:9", width: 2520, height: 1080 },
  ],
  controllerMobile: [
    { id: "controller-mobile-16-9", ratio: "16:9", width: 1280, height: 720 },
    { id: "controller-mobile-19_5-9", ratio: "19.5:9", width: 1560.43, height: 720 },
    { id: "controller-mobile-4-3", ratio: "4:3", width: 1280, height: 959.53 },
  ],
};
const previewPresetGroups = deviceModes.map((device) => ({ id: device.id, label: device.label, presets: previewPresets[device.id] }));
const projectName = ref("Untitled UI Animation"); const deviceMode = ref<DeviceMode>("pc"); const previewPresetId = ref("pc-16-9"); const canvasWidth = ref(1600); const canvasHeight = ref(900); const zoom = ref(0.55); const panX = ref(0); const panY = ref(0); const isPanning = ref(false); const selectedId = ref<string | null>(nodes.value[0].id); const search = ref(""); const collapsed = ref(new Set<string>()); const addMenuOpen = ref(false); const anchorMenuOpen = ref(false); const importMenuOpen = ref(false); const exportMenuOpen = ref(false); const luaExportMenuOpen = ref(false); const tweenFieldPickerNodeId = ref<string | null>(null); const tweenFieldSearch = ref(""); const fileInput = ref<HTMLInputElement | null>(null); const giaFileInput = ref<HTMLInputElement | null>(null); const giaImportStatus = ref(""); const currentTime = ref(0); const duration = computed({ get: () => activeAnimation.value.duration, set: (value: number) => { activeAnimation.value.duration = value; } }); const frameRate = ref<number>(30); const playing = ref(false); const tweenTracks = ref<UITweenTrack[]>([]); const selectedTweenTrackId = ref<string | null>(null); const draggingTweenTrackId = ref<string | null>(null); const resizingTweenEdge = ref<"start" | "end" | null>(null); const timelineContent = ref<HTMLElement | null>(null); const timelineTrackNames = ref<HTMLElement | null>(null); const timelinePanel = ref<HTMLElement | null>(null); const editorElement = ref<HTMLElement | null>(null); const viewportElement = ref<HTMLElement | null>(null); const hierarchyTree = ref<HTMLElement | null>(null); const cursorPosition = ref({ x: 0, y: 0 }); const timelineHeight = ref<number | null>(null); const timelineResizing = ref(false); const timelineScrubbing = ref(false); const editorHeight = ref(0);
const animations = ref<UIAnimation[]>([{ id: "animation-default", name: "默认动画", duration: 5, keyframeTracks: [] }]);
const activeAnimationId = ref("animation-default");
const eventPreviewLog = ref<string[]>([]);
let eventPlaybackStarted = false;
function updateTimelineEvents(events: UITimelineEvent[]) {
  if (!hasOpenDocument.value) return;
  playing.value = false;
  activeAnimation.value.events = normalizeTimelineEvents(events, nodes.value);
}
function previewEvents(from: number, to: number, includeStart = false) {
  const entries = crossedTimelineEvents(activeAnimation.value.events ?? [], from, to, includeStart);
eventPreviewLog.value = [...eventPreviewLog.value, ...entries.map(e => `${e.time.toFixed(3)}s · ${e.name} · ${nodes.value.find(n => n.id === e.nodeId)?.name ?? '动画根控件'} · ${e.params}`)].slice(-50);
}
function advanceTimelinePlayback(delta: number) {
  const length = duration.value;
  if (!(length > 0) || !(delta >= 0)) return;
  let from = currentTime.value, remaining = delta;
  if (!eventPlaybackStarted) { previewEvents(from, from, true); eventPlaybackStarted = true; }
  // Process every crossed interval, including endpoints and each new loop's zero.
  while (remaining >= length - from) {
    previewEvents(from, length); remaining -= length - from; from = 0;
    previewEvents(0, 0, true);
  }
  previewEvents(from, from + remaining);
  currentTime.value = from + remaining;
}
const activeAnimation = computed(() => animations.value.find(animation => animation.id === activeAnimationId.value) ?? animations.value[0]);
const keyframeTracks = computed({ get: () => activeAnimation.value.keyframeTracks, set: (value: UIKeyframeTrack[]) => { activeAnimation.value.keyframeTracks = value; } });
const animationNotice = ref("");
const animationsPanelCollapsed = ref(false);
const selectedKeyframeId = ref<string | null>(null);
const keyframeDocumentEpoch = ref(0);
const workspacePanelOpen = ref(false);
const timelineSnapEnabled = ref(true);
const boneToolsEnabled = ref(false);
const showContainerBones = ref(true);
const historyPanelOpen = ref(false);
const timelineSnapTime = ref<number | null>(null);
const timelineEditNotice = ref("");
// Editor-local snapshot: never serialize it or carry node references into another document.
const tweenClipClipboard = ref<UITweenTrack | null>(null);
const timelineDataImportOpen = ref(false);
const timelineDataSource = ref("");
const timelineDataRootId = ref("");
const timelineDataImportMode = ref<TimelineDataImportMode>("append");
const timelineDataImportPreview = computed(() => !timelineDataImportOpen.value || !timelineDataSource.value.trim() ? null : prepareKeyframeTimelineImport({
  source: timelineDataSource.value, rootNodeId: timelineDataRootId.value, nodes: nodes.value,
  existingTracks: keyframeTracks.value, existingEvents: activeAnimation.value.events, mode: timelineDataImportMode.value, sequenceDuration: sequenceDurationValue(),
}));
const timelineDataImportSummary = computed(() => {
  const result = timelineDataImportPreview.value;
return result ? { schema: result.schema, importedCount: result.importedTracks.length, eventCount: result.importedEvents.length, replacedCount: result.replacedCount, duration: result.duration, errors: result.errors, warnings: result.warnings } : null;
});
const timelineDataRootOptions = computed(() => {
  const byId = new Map(nodes.value.map((node) => [node.id, node]));
  return getHierarchyOrder().map((node) => {
    const names = [node.name];
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      names.unshift(parent.name);
      parentId = parent.parentId;
    }
    return { id: node.id, label: names.join(" / ") };
  });
});
type ArchiveActionKind = "createWorkspace" | "renameWorkspace" | "deleteWorkspace" | "createDocument" | "renameDocument" | "deleteDocument";
const archiveAction = ref<{ kind: ArchiveActionKind; title: string; message: string; mode: "name" | "confirm"; initialValue: string } | null>(null);
const sharedStorage = inject<StorageClass | null>("storage", null);
const archive = sharedStorage ? useClientUIWorkspace(new ClientUIWorkspaceRepository(sharedStorage), {
  capture: serializeProject,
  apply: applyProjectData,
  createBlank: createBlankProject,
  onBeforeSwitch: stopDocumentInteraction,
}) : null;
const hasOpenDocument = computed(() => !archive || Boolean(archive.selectedDocument.value));
type HierarchyDropMode = "inside" | "before" | "after" | null;
interface HierarchyDragState { nodeId: string | null; active: boolean; pointerX: number; pointerY: number; dropTargetId: string | null; dropParentId: string | null; dropMode: HierarchyDropMode; dropLabel: string }
const emptyHierarchyDrag = (): HierarchyDragState => ({ nodeId: null, active: false, pointerX: 0, pointerY: 0, dropTargetId: null, dropParentId: null, dropMode: null, dropLabel: "长按以开始拖动" });
const hierarchyDrag = ref<HierarchyDragState>(emptyHierarchyDrag());
const controlLabels = Object.fromEntries(controlDefinitions.map((definition) => [definition.type, definition.label])) as Record<ControlType, string>;
const addControlDefinitions = [...controlDefinitions.filter(control => control.type !== "primitive"), ...controlDefinitions.filter(control => control.type === "primitive")];
const currentDevice = computed(() => deviceModes.find((device) => device.id === deviceMode.value) ?? deviceModes[0]); const currentPreviewPresets = computed(() => previewPresets[deviceMode.value]); const currentPreset = computed(() => currentPreviewPresets.value.find((preset) => preset.id === previewPresetId.value) ?? currentPreviewPresets.value[0]); const isMobilePreview = computed(() => deviceMode.value === "mobile" || deviceMode.value === "controllerMobile");
const customCanvasLabel = computed(() => currentPreset.value.width === canvasWidth.value && currentPreset.value.height === canvasHeight.value ? undefined : `${canvasWidth.value} × ${canvasHeight.value}`);
interface Matrix2D { a: number; b: number; c: number; d: number }
const resizeCorners = ["tl", "tr", "bl", "br"] as const;
type ResizeCorner = typeof resizeCorners[number];
const canvasTools = [
  { id: "combined", label: "三合一", icon: "transform", hint: "拖动控件移动 · 顶部手柄旋转 · 四角调整大小" },
  { id: "move", label: "移动", icon: "move", hint: "拖动控件移动位置" },
  { id: "rotate", label: "旋转", icon: "rotate", hint: "拖动控件或圆环，绕轴心旋转" },
  { id: "scale", label: "缩放", icon: "scale", hint: "拖动控件等比缩放 · 红色 X / 绿色 Y 手柄单轴缩放" },
] as const;
type CanvasTool = typeof canvasTools[number]["id"];
const canvasTool = ref<CanvasTool>("combined");
const boneCreateMode = ref(false);
const boneHoverPointer = ref<{ x: number; y: number } | null>(null);
const boneHoverCtrl = ref(false);
const boneHoverTarget = computed(() => {
  const point = boneHoverPointer.value;
  return boneCreateMode.value && boneHoverCtrl.value && !isPanning.value && point
    ? boneAttachTargetAtPoint(point.x, point.y) : null;
});
function updateBoneHover(event: PointerEvent) {
  boneHoverPointer.value = { x: event.clientX, y: event.clientY };
  boneHoverCtrl.value = event.ctrlKey;
}
function clearBoneHover() { boneHoverPointer.value = null; boneHoverCtrl.value = false; }
function updateBoneHoverKey(event: KeyboardEvent) { boneHoverCtrl.value = event.ctrlKey; }
watch(boneCreateMode, clearBoneHover);
onMounted(() => {
  window.addEventListener("keydown", updateBoneHoverKey);
  window.addEventListener("keyup", updateBoneHoverKey);
  window.addEventListener("blur", clearBoneHover);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", updateBoneHoverKey);
  window.removeEventListener("keyup", updateBoneHoverKey);
  window.removeEventListener("blur", clearBoneHover);
});
const boneParentId = ref<string | null>(null);
const boneParent = computed(() => nodes.value.find(node => node.id === boneParentId.value && node.type === "container") ?? rootContainer.value);
const boneDraft = ref<{ start: BonePoint; end: BonePoint; parentId: string } | null>(null);
const boneDraftGuide = computed(() => {
  const draft = boneDraft.value;
  const parent = draft && previewWorldTransforms.value.get(draft.parentId);
  const geometry = draft && parent && boneGeometry(draft.start, draft.end, parent);
  if (!draft || !parent || !geometry) return null;
  const angle = geometry.rotation * Math.PI / 180;
  const matrix = multiplyMatrix(parent.matrix, { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle) });
  return { length: geometry.length, style: containerDirectionGuideStyle({ ...draft.start, matrix }, canvasHeight.value) };
});
const boneRootPoint = computed<CSSProperties | null>(() => {
  const root = rootContainer.value;
  const world = root && previewWorldTransforms.value.get(root.id);
  if (!boneCreateMode.value || !root || !world || !isVisibleInHierarchy(root)) return null;
  const point = canvasOverlayPoint(world.x, world.y);
  return { left: `calc(50% + ${point.x}px)`, top: `calc(50% + ${point.y}px)` };
});
const activeCanvasTool = computed(() => canvasTools.find(tool => tool.id === canvasTool.value)!);
interface WorldTransform { x: number; y: number; matrix: Matrix2D }
interface TimelineNodeRow { kind: "node"; key: string; node: UINode; trackCount: number }
interface TimelineTweenRow { kind: "tween"; key: string; node: UINode; track: UITweenTrack; tracks: UITweenTrack[]; field: TweenableFieldDefinition }
type TimelineRow = TimelineNodeRow | TimelineTweenRow;
const timelineContextMenu = ref<{ trackId: string; clipId: string | null; label: string; x: number; y: number; time: number; canCreate: boolean; createHint: string } | null>(null);
let timelineContextReturnFocus: HTMLElement | null = null;
const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedId.value) ?? null); const renderNodes = computed(() => getCanvasRenderOrder().filter(isVisibleInHierarchy)); const timelineNodes = computed(() => getHierarchyOrder());
const selectedDirectionArrowLength = computed(() => normalizeDirectionArrowLength(selectedNode.value?.editor?.directionArrowLength));
const renderContainerDirections = computed(() => {
  if (!showContainerBones.value && !boneCreateMode.value) return [];
  return renderNodes.value.filter((node) => node.type === "container").map((node) => {
    const displayNode = previewNode(node);
    const world = previewWorldTransforms.value.get(node.id) ?? { x: displayNode.x, y: displayNode.y, matrix: localMatrix(displayNode) };
    return { id: node.id, length: normalizeDirectionArrowLength(node.editor?.directionArrowLength), style: containerDirectionGuideStyle(world, canvasHeight.value) };
  }).filter((guide) => guide.length > 0);
});
function updateDirectionArrowLength(value: number | null) {
  const node = selectedNode.value;
  if (!node || node.type !== "container" || typeof value !== "number" || !Number.isFinite(value)) return;
  node.editor = { ...node.editor, directionArrowLength: normalizeDirectionArrowLength(value) };
}
const timelineRows = computed<TimelineRow[]>(() => {
  const rows: TimelineRow[] = [];
  for (const node of timelineNodes.value) {
    const fields = new Map<string, TimelineTweenRow>();
    for (const track of tweenTracks.value.filter((item) => item.nodeId === node.id)) {
      const field = getTweenableField(node.type, track.fieldKey);
      if (!field) continue;
      const row = fields.get(field.fieldKey);
      if (row) row.tracks.push(track);
      else fields.set(field.fieldKey, { kind: "tween", key: `tween:${node.id}:${field.fieldKey}`, node, track, tracks: [track], field });
    }
    rows.push({ kind: "node", key: `node:${node.id}`, node, trackCount: fields.size });
    for (const row of fields.values()) {
      row.tracks = orderTweenClips(row.tracks);
      row.track = row.tracks[0];
      rows.push(row);
    }
  }
  return rows;
});
const selectedTweenTrack = computed(() => tweenTracks.value.find((track) => track.id === selectedTweenTrackId.value) ?? null);
const selectedTweenNode = computed(() => nodes.value.find((node) => node.id === selectedTweenTrack.value?.nodeId) ?? null);
const selectedTweenField = computed(() => { const node = selectedTweenNode.value; const track = selectedTweenTrack.value; return node && track ? getTweenableField(node.type, track.fieldKey) : null; });
const tweenTrackConflicts = computed(() => {
  const accepted: UITweenTrack[] = [];
  const conflicts = new Map<string, string>();
  for (const track of tweenTracks.value) {
    const node = nodes.value.find((item) => item.id === track.nodeId);
    const field = node ? getTweenableField(node.type, track.fieldKey) : null;
    if (!field || !Number.isFinite(track.startTime) || !Number.isFinite(track.duration) || track.duration <= 0) continue;
    const valid = field.valueKind === 'number'
      ? [track.initialValue, track.endValue].every((value) => typeof value === 'number' && Number.isFinite(value))
      : Boolean(normalizeColorRGBA(track.initialValue) && normalizeColorRGBA(track.endValue));
    if (!valid) continue;
    const conflict = accepted.some((other) => tweenClipsOverlap(track, other)) ? "同一属性轨道的 Clip 时间重叠。" : getTweenTrackConflict(track.nodeId, track.fieldKey, nodes.value, accepted);
    if (conflict) conflicts.set(track.id, conflict);
    else accepted.push(track);
  }
  return conflicts;
});
const previewNodes = computed(() => keyframeTracks.value.length ? buildKeyframePreviewNodes(currentTime.value) : buildTweenPreviewNodes(currentTime.value));
const inspectorNode = computed(() => selectedNode.value ? previewNode(selectedNode.value) : null);
const animatedPropertyFields = computed(() => keyframeTracks.value.filter(track => track.nodeId === selectedId.value).map(track => track.fieldKey));
const previewNodeMap = computed(() => new Map(previewNodes.value.map((node) => [node.id, node])));
const automaticTimelineHeight = computed(() => Math.min(320, Math.max(210, 80 + (timelineNodes.value.length + keyframeTracks.value.length) * 33)));
const timelineMaximumHeight = computed(() => editorHeight.value > 0 ? Math.max(MIN_TIMELINE_HEIGHT, editorHeight.value - EDITOR_TOOLBAR_HEIGHT - MIN_EDITOR_BODY_HEIGHT) : 520);
const resolvedTimelineHeight = computed(() => Math.min(timelineMaximumHeight.value, Math.max(MIN_TIMELINE_HEIGHT, timelineHeight.value ?? automaticTimelineHeight.value)));
const editorStyle = computed<CSSProperties>(() => ({ "--timeline-height": `${resolvedTimelineHeight.value}px` } as CSSProperties));
const selectedControlDefinition = computed(() => getControlDefinition(selectedNode.value?.type ?? "container"));
const imageLibraryOpen = ref(false);
const giaSource = shallowRef<GiaExportSource | null>(null);
const giaExportOpen = ref(false), giaExportBusy = ref(false), giaExportError = ref(""), giaExportNotice = ref("");
function openGiaExport() { exportMenuOpen.value = false; primitiveResourceLibraryOpen.value = false; templateLibraryOpen.value = false; imageLibraryOpen.value = false; giaExportError.value = ""; giaExportNotice.value = ""; giaExportOpen.value = true; }
function downloadGiaUI(options: { name: string; uiIndex: number }) {
  giaExportError.value = "";
  try {
    const result = exportGiaUI({ ...options, nodes: nodes.value, source: giaSource.value, deviceIndex: templateDeviceIndex.value });
    const url = URL.createObjectURL(new Blob([result.bytes.buffer as ArrayBuffer], { type: "application/octet-stream" }));
    const link = document.createElement("a"); link.href = url; link.download = `${options.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "ClientUI"}.gia`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    giaExportNotice.value = `已导出 ${result.controlCount} 个控件，二进制回读校验通过。`;
  } catch (error) { giaExportError.value = error instanceof Error ? error.message : "GIA 导出失败"; }
}
async function attachGiaSource(file: File) {
  giaExportBusy.value = true; giaExportError.value = "";
  const epoch = keyframeDocumentEpoch.value;
  try {
    const project = JSON.parse(await createGiaProject(file));
    if (epoch !== keyframeDocumentEpoch.value || !giaExportOpen.value) return;
    const source = normalizeGiaExportSource(project.giaSource);
    if (!source) throw new Error("文件中没有可用的 GIA 原始数据");
    source.baseline = createGiaExportBaseline(project.nodes, project.canvasWidth, project.canvasHeight);
    const originalIds = new Set(source.baseline.map(node => node.id));
    // Older imports displayed then-unknown native components as containers.
    // Keep that old editor baseline while retaining the real native component.
    source.baseline = source.baseline.map(before => {
      const current = nodes.value.find(node => node.id === before.id);
      if (current?.type === "container" && (before.type === "reference" || before.type === "uiAnimation")) {
        return { ...before, type: "container", properties: createControlProperties("container") };
      }
      return before;
    });
    const imported = nodes.value.filter(node => /^gia_node_\d+$/.test(node.id));
    if (!imported.length || imported.some(node => !originalIds.has(node.id))) throw new Error("这个 GIA 与当前控件树的来源 ID 不匹配，请选择最初导入的文件");
    giaSource.value = source;
    giaExportNotice.value = `已补充 ${file.name} 的原始组件，当前控件参数保持不变。`;
  } catch (error) { giaExportError.value = error instanceof Error ? error.message : "读取原始 GIA 失败"; }
  finally { giaExportBusy.value = false; }
}
const templateLibraryOpen = ref(false);
const controlTemplates = ref<ControlTemplateAsset[]>([]);
const primitiveResources = ref<PrimitiveImageResource[]>([]);
const primitiveResourceLibraryOpen = ref(false);
const primitiveResourceById = computed(() => new Map(primitiveResources.value.map(asset => [asset.id, asset])));
const fittedPrimitiveNodes = computed(() => nodes.value.filter(node => node.type === "primitive" && primitiveResourceById.value.get(node.properties.imageResourceId ?? "")?.fitData));
const allPrimitivesFitted = computed(() => fittedPrimitiveNodes.value.length > 0 && fittedPrimitiveNodes.value.every(node => node.type === "primitive" && node.properties.previewMode === "primitives"));
function toggleAllPrimitivePreviews() {
  if (!fittedPrimitiveNodes.value.length) return;
  const mode = allPrimitivesFitted.value ? "image" : "primitives";
  editorHistory.begin("primitive-preview-all");
  try {
    for (const node of nodes.value) {
      if (node.type === "primitive") node.properties.previewMode = mode === "primitives" && primitiveResourceById.value.get(node.properties.imageResourceId ?? "")?.fitData ? "primitives" : "image";
    }
  } finally { editorHistory.end("primitive-preview-all"); }
}
const selectedPrimitiveResource = computed(() => selectedNode.value?.type === "primitive" ? primitiveResourceById.value.get(selectedNode.value.properties.imageResourceId ?? "") ?? null : null);
const primitiveResourceUsage = computed(() => {
  const usage: Record<string, number> = {};
  for (const node of nodes.value) if (node.type === "primitive" && node.properties.imageResourceId) usage[node.properties.imageResourceId] = (usage[node.properties.imageResourceId] || 0) + 1;
  return usage;
});
function openPrimitiveResourceLibrary() { templateLibraryOpen.value = false; imageLibraryOpen.value = false; primitiveResourceLibraryOpen.value = true; }
function savePrimitiveResource(asset: PrimitiveImageResource) {
  const normalized = normalizePrimitiveResources([asset])[0];
  if (!normalized) return;
  const index = primitiveResources.value.findIndex(item => item.id === asset.id);
  if (index < 0) primitiveResources.value.push(normalized); else primitiveResources.value.splice(index, 1, normalized);
  if (!normalized.fitData) for (const node of nodes.value) if (node.type === "primitive" && node.properties.imageResourceId === asset.id) node.properties.previewMode = "image";
}
function removePrimitiveResource(id: string) { if (!primitiveResourceUsage.value[id]) primitiveResources.value = primitiveResources.value.filter(asset => asset.id !== id); }
function selectPrimitiveResource(id: string) {
  const node = selectedNode.value, resource = primitiveResourceById.value.get(id);
  if (node?.type !== "primitive" || !resource) return;
  node.properties = { imageUrl: "", imageResourceId: id, previewMode: resource.fitData ? "primitives" : "image" };
  primitiveResourceLibraryOpen.value = false;
}
const templateDeviceIndex = computed(() => ({ pc: 0, mobile: 1, controllerDesktop: 2, controllerMobile: 3 })[deviceMode.value]);
const controlTemplateByIndex = computed(() => new Map(controlTemplates.value.map(asset => [asset.index, asset])));
const selectedControlTemplate = computed(() => selectedNode.value?.type === "reference" ? controlTemplateByIndex.value.get(selectedNode.value.properties.referencedPrefabIndex ?? -1) ?? null : null);
const selectedControlTemplateLabel = computed(() => {
  const node = selectedNode.value;
  if (node?.type !== "reference" || node.properties.referencedPrefabIndex === null) return "未设置";
  return `#${node.properties.referencedPrefabIndex} · ${selectedControlTemplate.value?.name ?? '未找到模板'}`;
});
function openControlTemplateLibrary() { primitiveResourceLibraryOpen.value = false; imageLibraryOpen.value = false; templateLibraryOpen.value = true; }
function saveControlTemplate(asset: ControlTemplateAsset) {
  const error = templateIndexError(asset.index, controlTemplates.value, asset.id);
  if (error) { window.alert(error); return; }
  const previous = controlTemplates.value.find(item => item.id === asset.id);
  const next = normalizeControlTemplates([...controlTemplates.value.filter(item => item.id !== asset.id), asset]);
  editorHistory.begin("control-template");
  try {
    controlTemplates.value = next;
    if (previous && previous.index !== asset.index) {
      nodes.value.forEach(node => {
        if (node.type === "reference" && node.properties.referencedPrefabIndex === previous.index) node.properties.referencedPrefabIndex = asset.index;
      });
    }
  } finally { editorHistory.end("control-template"); }
}
function selectControlTemplate(index: number | null) {
  const node = selectedNode.value;
  if (node?.type !== "reference" || (index !== null && !controlTemplateByIndex.value.has(index))) return;
  editorHistory.begin("control-template-reference");
  try {
    const firstReference = node.properties.referencedPrefabIndex === null;
    node.properties.referencedPrefabIndex = index;
    if (firstReference && index !== null) resetControlTemplateSize();
    templateLibraryOpen.value = false;
  } finally { editorHistory.end("control-template-reference"); }
}
function resetControlTemplateSize() {
  if (!selectedControlTemplate.value || selectedNode.value?.type !== "reference") return;
  const scene = buildTemplateScene(selectedControlTemplate.value, templateDeviceIndex.value);
  editorHistory.begin("control-template-size");
  try { updateGeometry("width", scene.width); updateGeometry("height", scene.height); }
  finally { editorHistory.end("control-template-size"); }
}
const selectedInspectorDefinition = computed(() => selectedNode.value?.type === "image" ? { ...selectedControlDefinition.value, fields: selectedControlDefinition.value.fields.filter(field => !["imageSource", "imageId", "imageColor", "imageType"].includes(field.key)) } : selectedControlDefinition.value);
const tweenFieldPickerNode = computed(() => nodes.value.find((node) => node.id === tweenFieldPickerNodeId.value) ?? null);
const tweenFieldPickerCombos = computed(() => {
  const node = tweenFieldPickerNode.value;
  if (!node) return [];
  const available = new Set(availableTweenFields(node).map(field => field.fieldKey));
  const query = tweenFieldSearch.value.trim().toLowerCase();
  return [
    { label: "位置 XY", fields: ["anchoredPositionX", "anchoredPositionY"] },
    { label: "大小 XY", fields: ["sizeDeltaX", "sizeDeltaY"] },
  ].filter(combo => combo.fields.every(key => getTweenableField(node.type, key) && !tweenFieldConflict(node, key))
    && combo.fields.some(key => available.has(key))
    && (!query || `${combo.label} ${combo.fields.join(' ')}`.toLowerCase().includes(query)));
});
const selectedTweenPickerDefinition = computed(() => getControlDefinition(tweenFieldPickerNode.value?.type ?? "container"));
const tweenFieldPickerGroups = computed(() => {
  const node = tweenFieldPickerNode.value;
  if (!node) return [];
  const query = tweenFieldSearch.value.trim().toLowerCase();
  const fields = availableTweenFields(node).filter((field) => !query || `${field.label} ${field.fieldKey}`.toLowerCase().includes(query));
  return [
    { key: "group", title: "组合动画", description: "自身与全部后代 · 由 TweenTimelineLib 展开", fields: fields.filter((field) => field.source === "group") },
    { key: "base", title: "基础变换", description: "ClientUIBaseControl", fields: fields.filter((field) => field.source === "base") },
    { key: "control", title: controlLabels[node.type], description: selectedTweenPickerDefinition.value.runtimeClass, fields: fields.filter((field) => field.source === "properties") },
  ].filter((group) => group.fields.length > 0);
});
const selectedProperties = computed<Record<string, unknown>>({
  get: () => inspectorNode.value ? inspectorNode.value.properties as unknown as Record<string, unknown> : {},
  set: (value) => {
    const node = selectedNode.value;
    if (!node) return;
    const displayed = selectedProperties.value;
    for (const [key, next] of Object.entries(value)) {
      if (JSON.stringify(displayed[key]) === JSON.stringify(next)) continue;
      const field = getTweenableField(node.type, key);
      if (field && hasAnimatedField(key)) writeAnimatedValue(node, key, next as UITweenValue);
      else (node.properties as unknown as Record<string, unknown>)[key] = next;
    }
  },
});
const selectedImageAsset = computed(() => selectedNode.value?.type === "image" ? getImageAsset(selectedNode.value.properties.imageId) : null);
const rootContainer = computed(() => nodes.value.find((node) => node.type === "container" && node.parentId === null) ?? nodes.value.find((node) => node.type === "container") ?? null);
const draggedHierarchyNode = computed(() => nodes.value.find((node) => node.id === hierarchyDrag.value.nodeId) ?? null);
const hierarchyDragGhostStyle = computed<CSSProperties>(() => ({ left: `${hierarchyDrag.value.pointerX + 14}px`, top: `${hierarchyDrag.value.pointerY + 14}px` }));
function localMatrix(node: UINode): Matrix2D { const radians = node.rotation * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians); return { a: cosine * node.scaleX, b: sine * node.scaleX, c: -sine * node.scaleY, d: cosine * node.scaleY }; }
function multiplyMatrix(parent: Matrix2D, local: Matrix2D): Matrix2D { return { a: parent.a * local.a + parent.c * local.b, b: parent.b * local.a + parent.d * local.b, c: parent.a * local.c + parent.c * local.d, d: parent.b * local.c + parent.d * local.d }; }
function transformVector(matrix: Matrix2D, x: number, y: number) { return { x: matrix.a * x + matrix.c * y, y: matrix.b * x + matrix.d * y }; }
function calculateWorldTransforms(sourceNodes: UINode[]) { const result = new Map<string, WorldTransform>(); const resolving = new Set<string>(); const nodeMap = new Map(sourceNodes.map((node) => [node.id, node])); const resolve = (node: UINode): WorldTransform => { const cached = result.get(node.id); if (cached) return cached; const local = localMatrix(node); const parent = node.parentId ? nodeMap.get(node.parentId) : null; if (!parent || resolving.has(node.id)) { const root = { x: node.x, y: node.y, matrix: local }; result.set(node.id, root); return root; } resolving.add(node.id); const parentWorld = resolve(parent); resolving.delete(node.id); const offset = transformVector(parentWorld.matrix, node.x - parent.pivotX * parent.width, node.y - parent.pivotY * parent.height); const world = { x: parentWorld.x + offset.x, y: parentWorld.y + offset.y, matrix: multiplyMatrix(parentWorld.matrix, local) }; result.set(node.id, world); return world; }; sourceNodes.forEach(resolve); return result; }
const worldTransforms = computed(() => calculateWorldTransforms(nodes.value));
const previewWorldTransforms = computed(() => calculateWorldTransforms(previewNodes.value));
const selectedWorldPosition = computed(() => { const node = selectedNode.value; if (!node) return { x: 0, y: 0 }; const world = previewWorldTransforms.value.get(node.id); return { x: roundLayout(world?.x ?? node.x), y: roundLayout(world?.y ?? node.y) }; });
const selectedRuntimeLayoutValues = computed(() => inspectorNode.value ? getRuntimeLayoutValues(inspectorNode.value) : { anchoredPositionX: 0, anchoredPositionY: 0, sizeDeltaX: 0, sizeDeltaY: 0 });
const selectedAdditionalRuntimeTweenValues = computed(() => { const node = inspectorNode.value; if (!node) return []; return [
  { key: "anchorMinX", value: node.anchorMinX }, { key: "anchorMinY", value: node.anchorMinY },
  { key: "anchorMaxX", value: node.anchorMaxX }, { key: "anchorMaxY", value: node.anchorMaxY },
  { key: "pivotX", value: node.pivotX }, { key: "pivotY", value: node.pivotY },
  { key: "localScaleX", value: node.scaleX }, { key: "localScaleY", value: node.scaleY }, { key: "localScaleZ", value: node.scaleZ },
  { key: "localRotationX", value: node.rotationX }, { key: "localRotationY", value: node.rotationY }, { key: "localRotationZ", value: node.rotation },
]; });
const currentAnchorPresetId = computed(() => { const node = inspectorNode.value; if (!node) return "custom"; return anchorPresets.find((preset) => preset.anchorMinX === node.anchorMinX && preset.anchorMinY === node.anchorMinY && preset.anchorMaxX === node.anchorMaxX && preset.anchorMaxY === node.anchorMaxY)?.id ?? "custom"; });
const timeTicks = computed(() => Array.from({ length: 11 }, (_, index) => duration.value * index / 10)); const stageStyle = computed<CSSProperties>(() => ({ width: `${canvasWidth.value}px`, height: `${canvasHeight.value}px`, left: `calc(50% + ${panX.value}px)`, top: `calc(50% + ${panY.value}px)`, transform: `translate(-50%, -50%) scale(${zoom.value})` }));
const visibleTree = computed(() => { const result: Array<{ node: UINode; depth: number }> = []; const query = search.value.trim().toLowerCase(); const visit = (parentId: string | null, depth: number) => nodes.value.filter((node) => node.parentId === parentId).forEach((node) => { if (!query || node.name.toLowerCase().includes(query)) result.push({ node, depth }); if (!collapsed.value.has(node.id)) visit(node.id, depth + 1); }); visit(null, 0); return result; });
function nodeIcon(type: ControlType) { return controlRegistry[type].icon; } function hasChildren(id: string) { return nodes.value.some((node) => node.parentId === id); }
function isVisibleInHierarchy(node: UINode) { const visited = new Set<string>(); let current: UINode | undefined = previewNode(node); while (current && !visited.has(current.id)) { if (!current.visible) return false; visited.add(current.id); current = current.parentId ? previewNodeMap.value.get(current.parentId) : undefined; } return true; }
function isDescendant(id: string, possibleAncestor: string | null): boolean { let current = nodes.value.find((node) => node.id === id); while (current?.parentId) { if (current.parentId === possibleAncestor) return true; current = nodes.value.find((node) => node.id === current?.parentId); } return false; }
const anchorPopoverStyle = ref<CSSProperties>({});
function toggleAnchorPopover(event: MouseEvent) {
  if (anchorMenuOpen.value) { anchorMenuOpen.value = false; return; }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const size = Math.max(0, Math.min(320, window.innerWidth - 16, window.innerHeight - 16));
  anchorPopoverStyle.value = {
    width: `${size}px`, height: `${size}px`,
    left: `${Math.max(8, Math.min(rect.left - size - 10, window.innerWidth - size - 8))}px`,
    top: `${Math.max(8, Math.min(rect.top - size / 2 + rect.height / 2, window.innerHeight - size - 8))}px`,
  };
  anchorMenuOpen.value = true;
}
function closeAnchorPopover() { anchorMenuOpen.value = false; }
onMounted(() => window.addEventListener('resize', closeAnchorPopover));
onBeforeUnmount(() => window.removeEventListener('resize', closeAnchorPopover));
function toggleCollapsed(id: string) { const next = new Set(collapsed.value); next.has(id) ? next.delete(id) : next.add(id); collapsed.value = next; } function closeMenus() { importMenuOpen.value = false; exportMenuOpen.value = false; historyPanelOpen.value = false; addMenuOpen.value = false; anchorMenuOpen.value = false; luaExportMenuOpen.value = false; closeTweenFieldPicker(); closeTimelineContextMenu(); }
function clampTimelineHeight(value: number) { return Math.min(timelineMaximumHeight.value, Math.max(MIN_TIMELINE_HEIGHT, Math.round(value))); }
function resetTimelineHeight() { timelineHeight.value = null; }
function nudgeTimelineHeight(delta: number) { timelineHeight.value = clampTimelineHeight(resolvedTimelineHeight.value + delta); }
let stopTimelineResize: (() => void) | null = null;
function startTimelineResize(event: PointerEvent) {
  if (event.button !== 0 || !timelinePanel.value) return;
  event.preventDefault();
  stopTimelineResize?.();
  const pointerId = event.pointerId;
  const startY = event.clientY;
  const startHeight = timelinePanel.value.getBoundingClientRect().height || resolvedTimelineHeight.value;
  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;
  timelineHeight.value = clampTimelineHeight(startHeight);
  timelineResizing.value = true;
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
  const move = (nextEvent: PointerEvent) => {
    if (nextEvent.pointerId !== pointerId) return;
    nextEvent.preventDefault();
    timelineHeight.value = clampTimelineHeight(startHeight + startY - nextEvent.clientY);
  };
  const cleanup = (nextEvent?: PointerEvent) => {
    if (nextEvent && nextEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    timelineResizing.value = false;
    if (stopTimelineResize === cleanup) stopTimelineResize = null;
  };
  stopTimelineResize = cleanup;
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}

/** Keyframes own animation values; the untouched node model remains the relative baseline. */
function selectAnimation(id: string) {
  if (!hasOpenDocument.value || !animations.value.some(animation => animation.id === id) || id === activeAnimationId.value) return;
  finishEditorHistoryInteraction();
  stopDocumentInteraction();
  activeAnimationId.value = id;
  eventPreviewLog.value = []; eventPlaybackStarted = false;
  currentTime.value = 0;
  selectedKeyframeId.value = null;
  selectedTweenTrackId.value = null;
  tweenClipClipboard.value = null;
  animationNotice.value = "";
  timelineEditNotice.value = "";
}
function createAnimation() {
  if (!hasOpenDocument.value) return;
  const animation: UIAnimation = { id: createTweenId(), name: uniqueAnimationName(animations.value, "新动画"), duration: 5, keyframeTracks: [] };
  animations.value.push(animation);
  selectAnimation(animation.id);
}
function duplicateAnimation() {
  if (!hasOpenDocument.value) return;
  const source = activeAnimation.value;
  const animation: UIAnimation = JSON.parse(JSON.stringify(source));
  animation.id = createTweenId();
  animation.name = uniqueAnimationName(animations.value, `${source.name.slice(0, 70)} 副本`);
  animation.keyframeTracks.forEach(track => { track.id = createTweenId(); track.keyframes.forEach(key => { key.id = createTweenId(); }); });
  animation.events?.forEach(event => { event.id = createTweenId(); });
  animations.value.push(animation);
  selectAnimation(animation.id);
}
function renameAnimation(value: string) {
  if (!hasOpenDocument.value) return;
  const name = value.trim();
  if (!name || name.length > 80 || /[\x00-\x1f]/.test(name) || animations.value.some(animation => animation.id !== activeAnimationId.value && animation.name === name)) {
    animationNotice.value = "请输入不重复的动画名称（1–80 个字符）。";
    return;
  }
  activeAnimation.value.name = name;
  animationNotice.value = "";
}
function removeAnimation(id: string) {
  if (!hasOpenDocument.value || animations.value.length <= 1 || !animations.value.some(animation => animation.id === id)) return;
  if (id === activeAnimationId.value) selectAnimation(animations.value.find(animation => animation.id !== id)!.id);
  animations.value = animations.value.filter(animation => animation.id !== id);
}
function keyframeConflictClips(): UITweenTrack[] {
  return keyframeTracks.value.map(track => ({ id: track.id, nodeId: track.nodeId, fieldKey: track.fieldKey, startTime: 0, duration: 1, initialValue: 0, endValue: 0, easeType: "Linear" }));
}
function hasAnimatedField(fieldKey: string, nodeId = selectedId.value) {
  return keyframeTracks.value.some(track => track.nodeId === nodeId && track.fieldKey === fieldKey);
}
function keyframeBase(track: UIKeyframeTrack): UITweenValue {
  const node = nodes.value.find(item => item.id === track.nodeId);
  const field = node ? getTweenableField(node.type, track.fieldKey) : null;
  return node && field ? readTweenFieldValue(node, field) : null;
}
const timelineTrackValues = computed<Record<string, UITweenValue>>(() => Object.fromEntries(keyframeTracks.value.map(track => [track.id, evaluateKeyframeTrack(track, currentTime.value, keyframeBase(track))])));
function editTimelineTrackValue(trackId: string, value: UITweenValue) {
  const track = keyframeTracks.value.find(item => item.id === trackId);
  const node = track && nodes.value.find(item => item.id === track.nodeId);
  if (!track || !node || value === null) return;
  selectedId.value = node.id;
  writeAnimatedValue(node, track.fieldKey, value);
}
function keyframePreviousValue(track: UIKeyframeTrack, time: number): UITweenValue {
  const previous = resolveKeyframeTrack(track, keyframeBase(track)).filter(key => key.time < time - 0.000001 && key.value !== null).at(-1);
  return previous ? cloneTweenValue(previous.value) : keyframeBase(track);
}
function selectKeyframeNode(id: string) {
  const node = nodes.value.find(item => item.id === id);
  if (node) selectHierarchyNode(node);
}
function openKeyframeFieldPicker(id: string) {
  const node = nodes.value.find(item => item.id === id);
  if (node) openTweenFieldPicker(node);
}
function selectKeyframeTrack(trackId: string) {
  const track = keyframeTracks.value.find(item => item.id === trackId);
  if (!track) return;
  selectedId.value = track.nodeId;
  const keys = [...track.keyframes].sort((a, b) => a.time - b.time);
  selectedKeyframeId.value = (keys.filter(key => key.time <= currentTime.value + 0.000001).at(-1) ?? keys[0])?.id ?? null;
  selectedTweenTrackId.value = null;
  playing.value = false;
}
function selectKeyframe(trackId: string, keyId: string) {
  const track = keyframeTracks.value.find(item => item.id === trackId);
  const key = track?.keyframes.find(item => item.id === keyId);
  if (!track || !key) return;
  selectedId.value = track.nodeId;
  selectedKeyframeId.value = key.id;
  selectedTweenTrackId.value = null;
  seekKeyframeTime(key.time);
}
function seekKeyframeTime(time: number) {
  if (!Number.isFinite(time)) return;
  playing.value = false;
  eventPlaybackStarted = true; // Seeking never dispatches, including the destination marker.
  currentTime.value = Math.max(0, Math.min(duration.value, time));
}
function addKeyframeTrackPair(node: UINode, fields: string[]) {
  for (const field of fields) addKeyframeTrack(node, field);
}
function addKeyframeTrack(node: UINode, fieldKey: string) {
  if (hasAnimatedField(fieldKey, node.id) || tweenFieldConflict(node, fieldKey)) return;
  const field = getTweenableField(node.type, fieldKey);
  if (!field) return;
  const value = readTweenFieldValue(previewNode(node), field);
  const key: UIKeyframe = { id: createTweenId(), time: roundTweenTime(currentTime.value), value: cloneTweenValue(value), easeType: "Linear", interpolation: field.valueKind === "boolean" ? "step" : "tween" };
  const track: UIKeyframeTrack = { id: createTweenId(), nodeId: node.id, fieldKey, keyframes: [key] };
  keyframeTracks.value.push(track);
  selectedId.value = node.id;
  selectedKeyframeId.value = key.id;
  playing.value = false;
  closeTweenFieldPicker();
  timelineEditNotice.value = "已创建关键帧轨道；修改淡红色参数会在当前播放头位置记录关键帧。";
}
function insertKeyframeAtTime(trackId: string, time: number) {
  const track = keyframeTracks.value.find(item => item.id === trackId);
  if (!track || !Number.isFinite(time) || time < 0 || time > duration.value) return;
  const existing = track.keyframes.find(key => Math.abs(key.time - time) <= 0.000001);
  if (existing) { selectKeyframe(track.id, existing.id); return; }
  const value = evaluateKeyframeTrack(track, time, keyframeBase(track));
  const following = resolveKeyframeTrack(track, keyframeBase(track)).find(key => key.time > time + 0.000001);
  const previous = [...track.keyframes].sort((a, b) => a.time - b.time).filter(key => key.time < time).at(-1);
  const relative = previous?.relative === true && isRelativeTweenField(track.fieldKey) && typeof value === "number";
  const basis = keyframePreviousValue(track, time);
  const key: UIKeyframe = { id: createTweenId(), time: roundTweenTime(time), value: relative && typeof basis === "number" ? value as number - basis : cloneTweenValue(value), relative, easeType: previous?.easeType ?? "Linear", interpolation: track.fieldKey === "visible" ? "step" : previous?.interpolation ?? "tween" };
  track.keyframes.push(key);
  track.keyframes.sort((a,b) => a.time - b.time);
  // Inserting an interpolated key must not add its offset to all later keys twice.
  if (following && typeof value === "number") {
    const next = track.keyframes.find(item => item.id === following.id)!;
    if (next.relative && typeof following.value === "number") next.value = following.value - value;
    if (next.incomingRelative && typeof following.incomingValue === "number") next.incomingValue = following.incomingValue - value;
  }
  selectKeyframe(track.id, key.id);
}
function writeAnimatedValue(node: UINode, fieldKey: string, value: UITweenValue) {
  // Static scale is still editable (inspector, gizmo and reparent compensation),
  // but these axes must never create/update a Tween or a keyframe.
  if (fieldKey === "localScaleX" || fieldKey === "localScaleY") {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    node[fieldKey === "localScaleX" ? "scaleX" : "scaleY"] = value;
    applyNodeLayout(node);
    applyDescendantLayouts(node.id);
    return;
  }
  const field = getTweenableField(node.type, fieldKey);
  if (!field || value === null || (typeof value === "number" && !Number.isFinite(value))) return;
  const track = keyframeTracks.value.find(item => item.nodeId === node.id && item.fieldKey === fieldKey);
  if (!track) {
    const target = field.source === "base" ? node as unknown as Record<string, unknown> : node.properties as unknown as Record<string, unknown>;
    if (field.source !== "group") target[field.modelKey] = cloneTweenValue(value);
    if (field.source === "base") { applyNodeLayout(node); applyDescendantLayouts(node.id); }
    return;
  }
  playing.value = false;
  const time = roundTweenTime(currentTime.value);
  let key = track.keyframes.find(item => Math.abs(item.time - time) <= 0.000001);
  const created = !key;
  if (!key) {
    insertKeyframeAtTime(track.id, time);
    key = track.keyframes.find(item => Math.abs(item.time - time) <= 0.000001);
  }
  if (!key) return;
  const basis = keyframePreviousValue(track, key.time);
  key.value = key.relative && typeof value === "number" && typeof basis === "number" ? value - basis : cloneTweenValue(value);
  delete key.incomingValue;
  delete key.incomingRelative;
  selectedKeyframeId.value = key.id;
  if (created) timelineEditNotice.value = `已在 ${time} 秒为「${node.name} / ${field.label}」自动添加关键帧。`;
}
function normalizeRotationAngle(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value >= -180 && value <= 180) return value;
  return roundLayout((((value + 180) % 360) + 360) % 360 - 180);
}
function updateAnimatedBaseValue(fieldKey: string, value: number | null) {
  if (value !== null && /^localRotation[XYZ]$/.test(fieldKey)) value = Math.max(-180, Math.min(180, value));
  if (selectedNode.value && value !== null) writeAnimatedValue(selectedNode.value, fieldKey, value);
}
function tryKeyframeGeometry(field: "x" | "y" | "width" | "height", value: number) {
  const runtimeField = { x: "anchoredPositionX", y: "anchoredPositionY", width: "sizeDeltaX", height: "sizeDeltaY" }[field];
  const source = selectedNode.value;
  // Even an unkeyed child is positioned in its animated parent's current layout.
  if (!source || !keyframeTracks.value.length || !Number.isFinite(value)) return false;
  const display = previewNode(source);
  const parent = display.parentId ? previewNodeMap.value.get(display.parentId) : null;
  const parentWidth = parent?.width ?? canvasWidth.value, parentHeight = parent?.height ?? canvasHeight.value;
  if (field === "width" || field === "height") {
    const span = field === "width" ? (display.anchorMaxX - display.anchorMinX) * parentWidth : (display.anchorMaxY - display.anchorMinY) * parentHeight;
    writeAnimatedValue(source, runtimeField, Math.max(1, value) - span);
  } else {
    const world = previewWorldTransforms.value.get(display.id)!;
    const x = field === "x" ? value : world.x, y = field === "y" ? value : world.y;
    const parentWorld = parent ? previewWorldTransforms.value.get(parent.id) : null;
    const offset = parentWorld ? inverseTransformVector(parentWorld.matrix, x - parentWorld.x, y - parentWorld.y) : { x, y };
    const localX = offset.x + (parent ? parent.pivotX * parent.width : 0);
    const localY = offset.y + (parent ? parent.pivotY * parent.height : 0);
    const referenceX = ((1 - display.pivotX) * display.anchorMinX + display.pivotX * display.anchorMaxX) * parentWidth;
    const referenceY = ((1 - display.pivotY) * display.anchorMinY + display.pivotY * display.anchorMaxY) * parentHeight;
    const nextX = roundLayout(localX - referenceX), nextY = roundLayout(localY - referenceY);
    // Rotated parents couple world X/Y to both local axes. Unkeyed axes retain setup editing.
    if (Math.abs(nextX - display.anchorOffsetX) > 0.000001) writeAnimatedValue(source, "anchoredPositionX", nextX);
    if (Math.abs(nextY - display.anchorOffsetY) > 0.000001) writeAnimatedValue(source, "anchoredPositionY", nextY);
  }
  return true;
}
function startAnimatedCanvasMove(event: PointerEvent, node: UINode) {
  if (!keyframeTracks.value.length) return false;
  playing.value = false;
  const world = previewWorldTransforms.value.get(node.id)!;
  let movedX = false, movedY = false;
  pointerDrag(event, (dx, dy) => {
    if (dx !== 0 || movedX) { movedX = true; updateGeometry("x", roundLayout(world.x + dx)); }
    if (dy !== 0 || movedY) { movedY = true; updateGeometry("y", roundLayout(world.y - dy)); }
  });
  return true;
}
function startAnimatedCanvasResize(event: PointerEvent, node: UINode, corner: ResizeCorner) {
  if (!keyframeTracks.value.length) return false;
  selectedId.value = node.id;
  playing.value = false;
  const pose = previewNode(node);
  const world = previewWorldTransforms.value.get(node.id)!;
  const matrix = world.matrix;
  const left = corner === "tl" || corner === "bl";
  const top = corner === "tl" || corner === "tr";
  let resizedX = false, resizedY = false;
  pointerDrag(event, (dx, dy) => {
    const delta = inverseTransformVector(matrix, dx, -dy);
    const width = delta.x !== 0 || resizedX ? Math.max(20, pose.width + (left ? -delta.x : delta.x)) : pose.width;
    const height = delta.y !== 0 || resizedY ? Math.max(20, pose.height + (top ? delta.y : -delta.y)) : pose.height;
    if (delta.x !== 0 || resizedX) { resizedX = true; updateGeometry("width", width); }
    if (delta.y !== 0 || resizedY) { resizedY = true; updateGeometry("height", height); }
    if (resizedX || resizedY) {
      // Keep the corner opposite the dragged handle fixed in world space.
      const shift = transformVector(matrix, (width - pose.width) * (pose.pivotX - (left ? 1 : 0)), (height - pose.height) * (pose.pivotY - (top ? 0 : 1)));
      updateGeometry("x", world.x + shift.x);
      updateGeometry("y", world.y + shift.y);
    }
  });
  return true;
}
function moveKeyframe(trackId: string, keyId: string, time: number) {
  const track = keyframeTracks.value.find(item => item.id === trackId);
  const key = track?.keyframes.find(item => item.id === keyId);
  if (!track || !key || !Number.isFinite(time)) return;
  const next = roundTweenTime(Math.max(0, Math.min(duration.value, time)));
  if (track.keyframes.some(other => other.id !== key.id && Math.abs(other.time - next) <= 0.000001)) {
    timelineEditNotice.value = "同一轨道同一时间只能有一个关键帧。";
    return;
  }
  key.time = next;
  track.keyframes.sort((a,b) => a.time - b.time);
  selectKeyframe(track.id, key.id);
}
function updateKeyframe(trackId: string, keyId: string, patch: Partial<UIKeyframe>) {
  const track = keyframeTracks.value.find(item => item.id === trackId);
  const key = track?.keyframes.find(item => item.id === keyId);
  if (!track || !key) return;
  if (typeof patch.time === "number") moveKeyframe(trackId, keyId, patch.time);
  if (typeof patch.relative === "boolean" && isRelativeTweenField(track.fieldKey) && patch.relative !== Boolean(key.relative)) {
    const actual = evaluateKeyframeTrack(track, key.time, keyframeBase(track));
    const basis = keyframePreviousValue(track, key.time);
    if (typeof actual === "number" && typeof basis === "number") {
      key.value = patch.relative ? actual - basis : actual;
      key.relative = patch.relative;
    }
  }
  if (patch.value !== undefined && patch.value !== null) {
    const field = getTweenableField(nodes.value.find(node => node.id === track.nodeId)?.type ?? "container", track.fieldKey);
    if (field?.valueKind === "boolean" ? typeof patch.value === "boolean" : field?.valueKind === "number" ? typeof patch.value === "number" && Number.isFinite(patch.value) : Boolean(normalizeColorRGBA(patch.value))) {
      key.value = cloneTweenValue(patch.value);
      delete key.incomingValue;
      delete key.incomingRelative;
    }
  }
  if (patch.easeType && isTweenEaseType(patch.easeType)) key.easeType = patch.easeType;
  if (patch.interpolation === "tween" || patch.interpolation === "step") key.interpolation = patch.interpolation;
  if (track.fieldKey === "visible") { key.interpolation = "step"; key.easeType = "Linear"; }
  playing.value = false;
}
function removeKeyframe(trackId: string, keyId: string) {
  const track = keyframeTracks.value.find(item => item.id === trackId);
  if (!track) return;
  track.keyframes = track.keyframes.filter(key => key.id !== keyId);
  if (!track.keyframes.length) removeKeyframeTrack(trackId);
  if (selectedKeyframeId.value === keyId) selectedKeyframeId.value = null;
}
function removeKeyframeTrack(trackId: string) {
  keyframeTracks.value = keyframeTracks.value.filter(track => track.id !== trackId);
  selectedKeyframeId.value = null;
}
function updateKeyframeDuration(value: number) {
  if (!Number.isFinite(value)) return;
  const last = Math.max(0.5, ...(activeAnimation.value.events ?? []).map(e => e.time), ...keyframeTracks.value.flatMap(track => track.keyframes.map(key => key.time)));
  duration.value = Math.max(value, last);
  currentTime.value = Math.min(currentTime.value, duration.value);
  timelineEditNotice.value = value < last ? "时长不能短于最后一个关键帧。" : "";
}
function buildKeyframePreviewNodes(time: number) {
  const cloned = nodes.value.map(node => ({ ...node, properties: { ...node.properties } } as UINode));
  const byId = new Map(cloned.map(node => [node.id, node]));
  for (const track of keyframeTracks.value) {
    const node = byId.get(track.nodeId);
    const field = node ? getTweenableField(node.type, track.fieldKey) : null;
    if (!node || !field) continue;
    const value = evaluateKeyframeTrack(track, time, keyframeBase(track));
    if (value === null) continue;
    if (field.source === "group" && typeof value === "number") {
      for (const source of getTweenGroupNodes(node.id, nodes.value)) {
        const target = byId.get(source.id);
        if (!target) continue;
        for (const colorKey of getGroupAlphaColorFields(source.type)) {
          const base = normalizeColorRGBA((source.properties as unknown as Record<string, unknown>)[colorKey]);
          if (!base) continue;
          const baseAlpha = Math.round(base.a * GROUP_ALPHA_MAX);
          const colorValue = (alpha: UITweenValue): UITweenValue => typeof alpha === "number"
            ? { ...base, a: Math.round(baseAlpha * Math.max(0, Math.min(GROUP_ALPHA_MAX, alpha)) / GROUP_ALPHA_MAX) / GROUP_ALPHA_MAX }
            : null;
          const colorTrack: UIKeyframeTrack = { ...track, fieldKey: colorKey, keyframes: resolveKeyframeTrack(track, keyframeBase(track)).map(key => ({
            ...key, relative: false, incomingRelative: false, value: colorValue(key.value), incomingValue: colorValue(key.incomingValue),
          })) };
          const color = evaluateKeyframeTrack(colorTrack, time, base);
          if (color !== null) (target.properties as unknown as Record<string, unknown>)[colorKey] = color;
        }
      }
    } else {
      const target = field.source === "base" ? node as unknown as Record<string, unknown> : node.properties as unknown as Record<string, unknown>;
      target[field.modelKey] = cloneTweenValue(value);
    }
  }
  getHierarchyOrder().forEach(source => { const node = byId.get(source.id); if (node) applyPreviewNodeLayout(node, byId); });
  return cloned;
}

function availableTweenFields(node: UINode) { const used = new Set([...keyframeTracks.value, ...tweenTracks.value].filter(track => track.nodeId === node.id).map(track => track.fieldKey)); return getTweenableFields(node.type).filter((field) => !used.has(field.fieldKey)); }
function tweenFieldConflict(node: UINode, fieldKey: string) { return getTweenTrackConflict(node.id, fieldKey, nodes.value, [...tweenTracks.value, ...keyframeConflictClips()]); }
function selectHierarchyNode(node: UINode, event?: MouseEvent) { if (boneCreateMode.value && event?.ctrlKey) { attachControlToBone(node); return; } if (boneCreateMode.value && node.type === "container") boneParentId.value = node.id; selectedKeyframeId.value = null; selectedId.value = node.id; selectedTweenTrackId.value = null; closeTweenFieldPicker(); }
function selectTimelineNode(node: UINode) { selectHierarchyNode(node); }
function openTweenFieldPicker(node: UINode) { selectedId.value = node.id; selectedTweenTrackId.value = null; tweenFieldSearch.value = ""; tweenFieldPickerNodeId.value = node.id; }
function closeTweenFieldPicker() { tweenFieldPickerNodeId.value = null; tweenFieldSearch.value = ""; }
type TweenValueSlot = "initialValue" | "endValue";
function normalizeColorRGBA(value: unknown): ColorRGBA | null { if (!value || typeof value !== "object") return null; const color = value as Partial<ColorRGBA>; if (![color.r, color.g, color.b, color.a].every((part) => typeof part === "number" && Number.isFinite(part))) return null; return { r: Math.min(255, Math.max(0, Math.round(color.r as number))), g: Math.min(255, Math.max(0, Math.round(color.g as number))), b: Math.min(255, Math.max(0, Math.round(color.b as number))), a: clamp01(color.a as number) }; }
function cloneTweenValue(value: UITweenValue): UITweenValue { const color = normalizeColorRGBA(value); return color ?? value; }
function readTweenFieldValue(node: UINode, field: TweenableFieldDefinition): UITweenValue { if (field.fieldKey === GROUP_ALPHA_FIELD_KEY) return GROUP_ALPHA_MAX; if (field.fieldKey === "anchoredPositionX" || field.fieldKey === "anchoredPositionY") return getRuntimeLayoutValues(node)[field.fieldKey]; const source = field.source === "base" ? node as unknown as Record<string, unknown> : node.properties as unknown as Record<string, unknown>; const rawValue = source[field.modelKey]; if (field.valueKind === "boolean") return typeof rawValue === "boolean" ? rawValue : null; if (field.valueKind === "number") return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null; return normalizeColorRGBA(rawValue); }
function normalizeTweenValue(value: unknown, field: TweenableFieldDefinition, fallback: UITweenValue): UITweenValue { if (value === null) return null; if (field.valueKind === "boolean" && typeof value === "boolean") return value; if (field.valueKind === "number" && typeof value === "number" && Number.isFinite(value)) return value; if (field.valueKind === "color") { const color = normalizeColorRGBA(value); if (color) return color; } return cloneTweenValue(fallback); }
/** v4 保存世界坐标和实际尺寸；转换为锚点偏移和 sizeDelta。 */
function convertAbsoluteTweenEditorValueToRuntime(node: UINode, field: TweenableFieldDefinition, value: UITweenValue): UITweenValue {
  if (typeof value !== "number") return value;
  const parent = getLayoutParent(node);
  const parentSize = getLayoutParentSize(node);
  const reference = getAnchorReference(node);
  const world = worldTransforms.value.get(node.id) ?? { x: node.x, y: node.y, matrix: localMatrix(node) };
  const parentWorld = parent ? worldTransforms.value.get(parent.id) : null;
  if (field.fieldKey === "anchoredPositionX") {
    if (!parent || !parentWorld) return roundLayout(value - reference.x);
    const localOffset = inverseTransformVector(parentWorld.matrix, value - parentWorld.x, world.y - parentWorld.y);
    const localX = parent.pivotX * parent.width + localOffset.x;
    return roundLayout(localX - reference.x);
  }
  if (field.fieldKey === "anchoredPositionY") {
    if (!parent || !parentWorld) return roundLayout(value - reference.y);
    const localOffset = inverseTransformVector(parentWorld.matrix, world.x - parentWorld.x, value - parentWorld.y);
    const localY = parent.pivotY * parent.height + localOffset.y;
    return roundLayout(localY - reference.y);
  }
  if (field.fieldKey === "sizeDeltaX") return roundLayout(value - parentSize.width * (node.anchorMaxX - node.anchorMinX));
  if (field.fieldKey === "sizeDeltaY") return roundLayout(value - parentSize.height * (node.anchorMaxY - node.anchorMinY));
  return value;
}
/** v6 保存父级中心偏移（无父级时为画布坐标），v7 统一保存锚点偏移。 */
function convertParentCenteredTweenValueToRuntime(node: UINode, field: TweenableFieldDefinition, value: UITweenValue): UITweenValue {
  if (typeof value !== "number") return value;
  const parent = getLayoutParent(node);
  const reference = getAnchorReference(node);
  if (field.fieldKey === "anchoredPositionX") return roundLayout(value + (parent ? parent.width / 2 : 0) - reference.x);
  if (field.fieldKey === "anchoredPositionY") return roundLayout(value + (parent ? parent.height / 2 : 0) - reference.y);
  return value;
}
function interpolateTweenValue(initialValue: UITweenValue, endValue: UITweenValue, progress: number): UITweenValue { if (typeof initialValue === "number" && typeof endValue === "number") return initialValue + (endValue - initialValue) * progress; const initialColor = normalizeColorRGBA(initialValue); const endColor = normalizeColorRGBA(endValue); if (initialColor && endColor) return normalizeColorRGBA({ r: initialColor.r + (endColor.r - initialColor.r) * progress, g: initialColor.g + (endColor.g - initialColor.g) * progress, b: initialColor.b + (endColor.b - initialColor.b) * progress, a: initialColor.a + (endColor.a - initialColor.a) * progress }); if (initialValue === null) return progress >= 1 ? cloneTweenValue(endValue) : null; return cloneTweenValue(initialValue); }
function evaluateTweenTrackValue(track: UITweenTrack, time: number) { const rawProgress = time <= track.startTime ? 0 : time >= track.startTime + track.duration ? 1 : (time - track.startTime) / Math.max(MIN_TWEEN_DURATION, track.duration); return interpolateTweenValue(track.initialValue, track.endValue, applyTweenEase(track.easeType, rawProgress)); }
function applyPreviewNodeLayout(node: UINode, nodeMap: Map<string, UINode>) { const parent = node.parentId ? nodeMap.get(node.parentId) : null; const parentWidth = parent?.width ?? canvasWidth.value; const parentHeight = parent?.height ?? canvasHeight.value; const referenceX = ((1 - node.pivotX) * node.anchorMinX + node.pivotX * node.anchorMaxX) * parentWidth; const referenceY = ((1 - node.pivotY) * node.anchorMinY + node.pivotY * node.anchorMaxY) * parentHeight; node.x = roundLayout(referenceX + node.anchorOffsetX); node.y = roundLayout(referenceY + node.anchorOffsetY); node.width = roundLayout(Math.max(1, (node.anchorMaxX - node.anchorMinX) * parentWidth + node.sizeDeltaX)); node.height = roundLayout(Math.max(1, (node.anchorMaxY - node.anchorMinY) * parentHeight + node.sizeDeltaY)); }
function resolveTweenClipEndpoints() {
  const resolved = new Map<string, UITweenTrack>();
  const ends = new Map<string, UITweenValue>();
  for (const track of orderTweenClips(tweenTracks.value)) {
    if (tweenTrackConflicts.value.has(track.id)) continue;
    const node = nodes.value.find((item) => item.id === track.nodeId);
    const field = node ? getTweenableField(node.type, track.fieldKey) : null;
    if (!node || !field || !Number.isFinite(track.startTime) || track.startTime < 0 || !Number.isFinite(track.duration) || track.duration <= 0) continue;
    const valid = field.valueKind === "number"
      ? [track.initialValue, track.endValue].every((value) => typeof value === "number" && Number.isFinite(value))
      : Boolean(normalizeColorRGBA(track.initialValue) && normalizeColorRGBA(track.endValue));
    if (!valid) continue;
    const key = `${node.id}\0${field.fieldKey}`;
    let initialValue = cloneTweenValue(track.initialValue);
    let endValue = cloneTweenValue(track.endValue);
    if (track.relative === true && isRelativeTweenField(field.fieldKey)) {
      const base = ends.has(key) ? ends.get(key) : readTweenFieldValue(node, field);
      if (typeof base !== "number" || !Number.isFinite(base)) continue;
      initialValue = base + (initialValue as number);
      endValue = base + (endValue as number);
    }
    if (typeof initialValue === "number" && (!Number.isFinite(initialValue) || !Number.isFinite(endValue))) continue;
    resolved.set(track.id, { ...track, initialValue, endValue, relative: false });
    ends.set(key, endValue);
  }
  return resolved;
}
function getTweenRelativeBaseline(track: UITweenTrack): UITweenValue {
  const node = nodes.value.find((item) => item.id === track.nodeId);
  const field = node ? getTweenableField(node.type, track.fieldKey) : null;
  if (!node || !field) return null;
  let baseline = readTweenFieldValue(node, field);
  for (const previous of resolveTweenClipEndpoints().values()) {
    if (previous.id === track.id) break;
    if (previous.nodeId === track.nodeId && previous.fieldKey === track.fieldKey && previous.startTime + previous.duration <= track.startTime + 0.000001) baseline = previous.endValue;
  }
  return cloneTweenValue(baseline);
}
function buildTweenPreviewNodes(time: number) {
  const clonedNodes = nodes.value.map((node) => ({ ...node, properties: { ...node.properties } } as UINode));
  const nodeMap = new Map(clonedNodes.map((node) => [node.id, node]));
  const visitedLanes = new Set<string>();
  resolveTweenClipEndpoints().forEach((track) => {
    const laneKey = `${track.nodeId}\0${track.fieldKey}`;
    // 只有第一段的初值提前显示；未来 Clip 不得提前覆盖上一段的结束值。
    if (visitedLanes.has(laneKey) && time < track.startTime) return;
    visitedLanes.add(laneKey);
    const node = nodeMap.get(track.nodeId);
    if (!node) return;
    const field = getTweenableField(node.type, track.fieldKey);
    const value = field ? evaluateTweenTrackValue(track, time) : null;
    if (!field || value === null) return;
    if (field.source === "group") {
      // 使用基础颜色生成首尾 Color，再插值，与导出库创建的原生颜色 Tween 一致。
      // 每次取未动画化的 nodes，避免播放、拖动时间或回放时累乘 Alpha。
      if (typeof track.initialValue !== "number" || typeof track.endValue !== "number" ||
          !Number.isFinite(track.initialValue) || !Number.isFinite(track.endValue)) return;
      const from = Math.min(GROUP_ALPHA_MAX, Math.max(0, track.initialValue));
      const to = Math.min(GROUP_ALPHA_MAX, Math.max(0, track.endValue));
      for (const sourceNode of getTweenGroupNodes(node.id, nodes.value)) {
        const preview = nodeMap.get(sourceNode.id);
        if (!preview) continue;
        const sourceProperties = sourceNode.properties as unknown as Record<string, unknown>;
        const targetProperties = preview.properties as unknown as Record<string, unknown>;
        for (const key of getGroupAlphaColorFields(sourceNode.type)) {
          const base = normalizeColorRGBA(sourceProperties[key]);
          if (!base) continue;
          const baseAlpha = Math.round(base.a * GROUP_ALPHA_MAX);
          const alpha = evaluateTweenTrackValue({
            ...track,
            initialValue: Math.round(baseAlpha * from / GROUP_ALPHA_MAX),
            endValue: Math.round(baseAlpha * to / GROUP_ALPHA_MAX),
          }, time) as number;
          targetProperties[key] = { ...base, a: clamp01(alpha / GROUP_ALPHA_MAX) };
        }
      }
      return;
    }
    // anchoredPosition 由 registry 映射到 anchorOffset，与 GIA 和参数面板使用同一原值。
    const target = field.source === "base" ? node as unknown as Record<string, unknown> : node.properties as unknown as Record<string, unknown>;
    target[field.modelKey] = cloneTweenValue(value);
  });
  // 所有属性 Tween 先求值，再按父子顺序计算布局，包含父级大小和子级锚点的变化。
  getHierarchyOrder().forEach((sourceNode) => {
    const preview = nodeMap.get(sourceNode.id);
    if (preview) applyPreviewNodeLayout(preview, nodeMap);
  });
  return clonedNodes;
}
function previewNode<T extends UINode>(node: T) { return (previewNodeMap.value.get(node.id) ?? node) as T; }
function addTweenTrack(node: UINode, fieldKey: string) {
  if (tweenTracks.value.some((track) => track.nodeId === node.id && track.fieldKey === fieldKey)) return;
  addTweenClip(node, fieldKey, 0);
}
function addTweenClip(node: UINode, fieldKey: string, startTime: number) {
  const field = getTweenableField(node.type, fieldKey);
  if (!field || tweenFieldConflict(node, fieldKey)) return null;
  const gap = getTweenClipGap(tweenTracks.value, node.id, fieldKey, startTime, sequenceDurationValue(), MIN_TWEEN_DURATION);
  if (!gap) { timelineEditNotice.value = "此处已被 Clip 占用，或剩余空隙不足 0.01 秒。"; return null; }
  const track: UITweenTrack = { id: createTweenId(), nodeId: node.id, fieldKey, ...gap, initialValue: null, endValue: null, easeType: "Linear" };
  const previous = orderTweenClips(tweenTracks.value.filter((item) => item.nodeId === node.id && item.fieldKey === fieldKey && item.startTime + item.duration <= gap.startTime + 0.000001)).at(-1);
  const relative = previous?.relative === true && isRelativeTweenField(fieldKey);
  const currentValue = relative ? 0 : getTweenRelativeBaseline(track);
  track.initialValue = cloneTweenValue(currentValue);
  track.endValue = cloneTweenValue(currentValue);
  if (relative) track.relative = true;
  tweenTracks.value.push(track);
  selectedId.value = node.id;
  selectedTweenTrackId.value = track.id;
  timelineEditNotice.value = "";
  closeTweenFieldPicker();
  return track;
}
function isTweenRowSelected(row: TimelineTweenRow) { return (row.tracks ?? [row.track]).some((clip) => clip.id === selectedTweenTrackId.value); }
function copySelectedTweenClip() {
  const track = selectedTweenTrack.value;
  if (!track || selectedId.value !== track.nodeId) return null;
  tweenClipClipboard.value = { ...track, initialValue: cloneTweenValue(track.initialValue), endValue: cloneTweenValue(track.endValue) };
  timelineEditNotice.value = "已复制 Clip；移动播放头后按 Ctrl+V，在原属性轨道粘贴。";
  return tweenClipClipboard.value;
}
function pasteTweenClipAtPlayhead() {
  const source = tweenClipClipboard.value;
  if (!source) return null;
  const node = nodes.value.find((item) => item.id === source.nodeId);
  if (!node || !getTweenableField(node.type, source.fieldKey)) {
    timelineEditNotice.value = "无法粘贴：原控件或属性已不存在，请重新复制 Clip。";
    return null;
  }
  const conflict = tweenFieldConflict(node, source.fieldKey);
  if (conflict) { timelineEditNotice.value = `无法粘贴：${conflict}`; return null; }
  const startTime = Number(currentTime.value.toFixed(6));
  const endTime = startTime + source.duration;
  if (!Number.isFinite(startTime) || !Number.isFinite(source.duration) || source.duration < MIN_TWEEN_DURATION - TWEEN_CLIP_TIME_EPSILON
    || startTime < 0 || !Number.isFinite(endTime) || endTime > sequenceDurationValue() + TWEEN_CLIP_TIME_EPSILON) {
    timelineEditNotice.value = "无法粘贴：剩余序列时长不足以容纳完整 Clip，请移动播放头或延长序列。";
    return null;
  }
  const track: UITweenTrack = { ...source, startTime, id: createTweenId(), initialValue: cloneTweenValue(source.initialValue), endValue: cloneTweenValue(source.endValue) };
  if (tweenTracks.value.some((other) => tweenClipsOverlap(track, other))) {
    timelineEditNotice.value = "无法粘贴：此处空隙不足，会与同一属性轨道上的 Clip 重叠。";
    return null;
  }
  while (tweenTracks.value.some((other) => other.id === track.id)) track.id = createTweenId();
  playing.value = false;
  tweenTracks.value.push(track);
  selectedId.value = node.id;
  selectedTweenTrackId.value = track.id;
  closeTweenFieldPicker();
  timelineEditNotice.value = `已在 ${startTime} 秒粘贴 Clip。`;
  return track;
}
function selectTweenTrack(row: TimelineTweenRow, clip = (row.tracks ?? []).find((item) => item.id === selectedTweenTrackId.value) ?? row.track) { selectedId.value = row.node.id; selectedTweenTrackId.value = clip.id; closeTweenFieldPicker(); }
function openTimelineContextMenu(event: MouseEvent | KeyboardEvent, row: TimelineRow, clip?: UITweenTrack) {
  closeMenus();
  if (row.kind !== "tween" || !tweenTracks.value.some((track) => track.id === row.track.id)) return;
  event.preventDefault();
  event.stopPropagation();
  selectTweenTrack(row, clip);
  resetTimelineKeyboardShortcut();
  const rowElement = event.currentTarget as HTMLElement;
  timelineContextReturnFocus = rowElement.querySelector<HTMLElement>(".track-property-main, .tween-clip");
  const rect = (timelineContextReturnFocus ?? rowElement).getBoundingClientRect();
  const hasPointerPosition = "clientX" in event && (event.clientX !== 0 || event.clientY !== 0);
  const lanes = timelineContent.value;
  const laneRect = lanes?.getBoundingClientRect();
  const inLanes = lanes?.contains(rowElement) ?? false;
  const time = hasPointerPosition && inLanes && laneRect
    ? Math.max(0, Math.min(sequenceDurationValue(), (event.clientX - laneRect.left) / Math.max(1, lanes!.clientWidth) * sequenceDurationValue())) : currentTime.value;
  const gap = getTweenClipGap(tweenTracks.value, row.node.id, row.field.fieldKey, time, sequenceDurationValue(), MIN_TWEEN_DURATION);
  timelineContextMenu.value = {
    trackId: clip?.id ?? row.track.id, clipId: clip?.id ?? null, time,
    canCreate: Boolean(gap), createHint: gap ? "" : "此处已有 Clip，或可用时长不足 0.01 秒",
    label: `${row.node.name} · ${row.field.label}`,
    x: hasPointerPosition ? event.clientX : rect.left,
    y: hasPointerPosition ? event.clientY : rect.bottom,
  };
}
function closeTimelineContextMenu(restoreFocus = false) {
  const returnFocus = timelineContextReturnFocus;
  timelineContextMenu.value = null;
  timelineContextReturnFocus = null;
  if (restoreFocus) nextTick(() => {
    const target = returnFocus?.isConnected ? returnFocus : timelineTrackNames.value?.querySelector<HTMLElement>(".row-node.selected .track-node-main");
    target?.focus({ preventScroll: true });
  });
}
function deleteTimelineContextTrack(trackId: string) {
  // Keep the action tied to the right-clicked Line, even if selection changes.
  if (timelineContextMenu.value?.trackId !== trackId) return;
  closeTimelineContextMenu(true);
  removeTweenLane(trackId);
}
function createTimelineContextClip(trackId: string) {
  const menu = timelineContextMenu.value;
  if (!menu || menu.trackId !== trackId) return;
  const track = tweenTracks.value.find((item) => item.id === trackId);
  const node = track ? nodes.value.find((item) => item.id === track.nodeId) : null;
  if (!track || !node) { closeTimelineContextMenu(); return; }
  const time = menu.time;
  closeTimelineContextMenu(true);
  addTweenClip(node, track.fieldKey, time);
}
function deleteTimelineContextClip(trackId: string) {
  if (timelineContextMenu.value?.clipId !== trackId) return;
  closeTimelineContextMenu(true);
  removeTweenTrack(trackId);
}
watch([selectedTweenTrack, selectedId], () => closeTimelineContextMenu(), { flush: "sync" });
function removeTweenTrack(trackId: string) { if (draggingTweenTrackId.value === trackId) stopTweenClipDrag?.(); tweenTracks.value = tweenTracks.value.filter((track) => track.id !== trackId); if (selectedTweenTrackId.value === trackId) selectedTweenTrackId.value = null; }
function removeTweenLane(trackId: string) {
  const target = tweenTracks.value.find((track) => track.id === trackId);
  if (!target) return;
  const clips = tweenTracks.value.filter((track) => track.nodeId === target.nodeId && track.fieldKey === target.fieldKey);
  clips.forEach((clip) => removeTweenTrack(clip.id));
}
function sequenceDurationValue() { return Math.max(MIN_TWEEN_DURATION, Number(duration.value) || MIN_TWEEN_DURATION); }
function timelineGuideStyle(time: number): CSSProperties {
  const percent = Math.max(0, Math.min(100, (Number.isFinite(time) ? time : 0) / sequenceDurationValue() * 100));
  return {
    left: `clamp(0px, ${percent}%, calc(100% - 1px))`,
    // Match the 33px lane rows, but let CSS fill a taller viewport after panel resizing.
    height: `max(100%, ${timelineRows.value.length * 33}px)`,
  };
}
function roundTweenTime(value: number) { return Number(value.toFixed(6)); }
function tweenTrackStyle(track: UITweenTrack): CSSProperties { const sequenceDuration = sequenceDurationValue(); const clipDuration = Math.min(sequenceDuration, Math.max(MIN_TWEEN_DURATION, track.duration)); const start = Math.min(Math.max(0, sequenceDuration - clipDuration), Math.max(0, track.startTime)); return { left: `${(start / sequenceDuration) * 100}%`, width: `${(clipDuration / sequenceDuration) * 100}%` }; }
function tweenNumberValue(slot: TweenValueSlot) { const value = selectedTweenTrack.value?.[slot]; return typeof value === "number" && Number.isFinite(value) ? value : ""; }
function updateTweenNumberValue(slot: TweenValueSlot, value: number | null) { const track = selectedTweenTrack.value; if (!track) return; track[slot] = value !== null && Number.isFinite(value) ? value : null; }
function updateTweenRelative(enabled: boolean) {
  const track = selectedTweenTrack.value;
  const field = selectedTweenField.value;
  const node = selectedTweenNode.value;
  if (!track || !field || !node || !isRelativeTweenField(field.fieldKey) || (track.relative === true) === enabled) return;
  const base = getTweenRelativeBaseline(track);
  if (typeof base !== "number" || !Number.isFinite(base)) return;
  // 切换解释方式时换算首尾值，既保留动画效果，也保留用户尚未填写的空值。
  for (const slot of ["initialValue", "endValue"] as const) {
    const value = track[slot];
    if (typeof value === "number" && Number.isFinite(value)) track[slot] = Number((value + (enabled ? -base : base)).toFixed(8));
  }
  track.relative = enabled;
}
function tweenColorValue(slot: TweenValueSlot) { return normalizeColorRGBA(selectedTweenTrack.value?.[slot]) ?? { r: 255, g: 255, b: 255, a: 1 }; }
function updateTweenColorValue(slot: TweenValueSlot, value: ColorRGBA) { const track = selectedTweenTrack.value; const color = normalizeColorRGBA(value); if (track && color) track[slot] = color; }
function updateTweenTiming(key: "startTime" | "duration", rawValue: number | null) {
  const track = selectedTweenTrack.value;
  if (!track || rawValue === null || !Number.isFinite(rawValue)) return;
  const bounds = getTweenClipBounds(track, tweenTracks.value, sequenceDurationValue());
  const limit = key === "startTime" ? bounds.maxEnd - track.duration : bounds.maxEnd - track.startTime;
  const minimum = key === "startTime" ? bounds.minStart : MIN_TWEEN_DURATION;
  track[key] = Number(Math.min(limit, Math.max(minimum, rawValue)).toFixed(6));
  timelineEditNotice.value = Math.abs(track[key] - rawValue) > 0.000001 ? "已限制到相邻 Clip 或序列边界；同一属性的 Clip 不能重叠。" : "";
}
function updateSequenceDuration(rawValue: number | null) {
  const requested = rawValue !== null && Number.isFinite(rawValue) ? Math.max(0.5, rawValue) : 0.5;
  const lastEnd = tweenTracks.value.reduce((end, track) => Math.max(end, track.startTime + track.duration), 0.5);
  duration.value = Math.max(requested, lastEnd);
  timelineEditNotice.value = requested < lastEnd ? "序列时长不能短于已有 Clip 的结束时间；请先缩短或移除对应 Clip。" : "";
  currentTime.value = Math.min(currentTime.value, duration.value);
}
let stopTweenClipDrag: (() => void) | null = null;
function toggleTimelineSnapping() {
  timelineSnapEnabled.value = !timelineSnapEnabled.value;
  timelineSnapTime.value = null;
}
function startTweenClipDrag(event: PointerEvent, row: TimelineTweenRow, clip = row.track) { startTweenTimingDrag(event, { ...row, track: clip }, "move"); }
function startTweenEdgeDrag(event: PointerEvent, row: TimelineTweenRow, edge: "start" | "end", clip = row.track) { startTweenTimingDrag(event, { ...row, track: clip }, edge); }
function startTweenTimingDrag(event: PointerEvent, row: TimelineTweenRow, mode: TweenClipSnapMode) {
  if (event.button !== 0) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.closest?.<HTMLElement>(".tween-clip")?.focus?.({ preventScroll: true });
  selectTweenTrack(row, row.track);
  stopTweenClipDrag?.();
  stopTimelineScrub?.();
  const lanes = timelineContent.value;
  if (!lanes) return;
  playing.value = false;
  const width = Math.max(1, lanes.clientWidth);
  const pointerId = event.pointerId;
  const pointerStartX = event.clientX;
  const sequenceDuration = sequenceDurationValue();
  const clipDuration = Math.min(sequenceDuration, Math.max(MIN_TWEEN_DURATION, row.track.duration));
  const originalStart = Math.min(Math.max(0, sequenceDuration - clipDuration), Math.max(0, row.track.startTime));
  const bounds = getTweenClipBounds(row.track, tweenTracks.value, sequenceDuration);
  const allowedDuration = bounds.maxEnd - bounds.minStart;
  // 只记录其他 Clip，防止移动时吸住自身旧边界；播放头在拖动期间保持不变。
  const targets = [currentTime.value, 0, sequenceDuration, ...tweenTracks.value
    .filter((track) => track.id !== row.track.id)
    .flatMap((track) => [track.startTime, track.startTime + track.duration])];
  draggingTweenTrackId.value = row.track.id;
  resizingTweenEdge.value = mode === "move" ? null : mode;
  timelineSnapTime.value = null;
  const move = (nextEvent: PointerEvent) => {
    if (nextEvent.pointerId !== pointerId) return;
    nextEvent.preventDefault();
    const result = snapTweenClip({
      mode, startTime: originalStart - bounds.minStart, duration: clipDuration,
      deltaTime: (nextEvent.clientX - pointerStartX) / width * sequenceDuration,
      sequenceDuration: allowedDuration, minDuration: MIN_TWEEN_DURATION, laneWidth: width * allowedDuration / sequenceDuration,
      enabled: timelineSnapEnabled.value, targets: targets.filter((time) => time >= bounds.minStart && time <= bounds.maxEnd).map((time) => time - bounds.minStart),
    });
    row.track.startTime = Number((result.startTime + bounds.minStart).toFixed(6));
    row.track.duration = result.duration;
    timelineSnapTime.value = result.snapTime === null ? null : Number((result.snapTime + bounds.minStart).toFixed(6));
  };
  const cleanup = (nextEvent?: PointerEvent) => {
    if (nextEvent && nextEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("blur", cancel);
    if (draggingTweenTrackId.value === row.track.id) draggingTweenTrackId.value = null;
    resizingTweenEdge.value = null;
    timelineSnapTime.value = null;
    if (stopTweenClipDrag === cleanup) stopTweenClipDrag = null;
  };
  const cancel = () => cleanup();
  stopTweenClipDrag = cleanup;
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
  window.addEventListener("blur", cancel);
}
let syncingTimelineScroll = false;
function syncTimelineScroll(source: "names" | "content") { if (syncingTimelineScroll) return; const from = source === "names" ? timelineTrackNames.value : timelineContent.value; const to = source === "names" ? timelineContent.value : timelineTrackNames.value; if (!from || !to || Math.abs(to.scrollTop - from.scrollTop) < 1) return; syncingTimelineScroll = true; to.scrollTop = from.scrollTop; requestAnimationFrame(() => { syncingTimelineScroll = false; }); }
function addNode(type: ControlType) { let root = rootContainer.value; if (!root) { root = makeRootContainer(canvasWidth.value, canvasHeight.value); nodes.value.unshift(root); rebaseNodeLayout(root); } const parent = selectedNode.value ?? root; const count = nodes.value.filter((node) => node.type === type).length + 1; const node = makeNode(type, `${controlLabels[type]}_${count}`, { parentId: parent.id, x: parent.width / 2 + (count - 2) * 40, y: parent.height / 2 - (count - 2) * 30 }); rebaseNodeLayout(node); nodes.value.push(node); selectedId.value = node.id; addMenuOpen.value = false; }
function removeSelected() { if (!selectedId.value || selectedId.value === rootContainer.value?.id) return; const remove = new Set<string>([selectedId.value]); let changed = true; while (changed) { changed = false; nodes.value.forEach((node) => { if (node.parentId && remove.has(node.parentId) && !remove.has(node.id)) { remove.add(node.id); changed = true; } }); } nodes.value = nodes.value.filter((node) => !remove.has(node.id)); tweenTracks.value = tweenTracks.value.filter((track) => !remove.has(track.nodeId)); animations.value.forEach(animation => { animation.keyframeTracks = animation.keyframeTracks.filter(track => !remove.has(track.nodeId)); animation.events = animation.events?.filter(event => event.nodeId === null || !remove.has(event.nodeId)); }); selectedKeyframeId.value = null; selectedTweenTrackId.value = null; selectedId.value = rootContainer.value?.id ?? null; }
function anchorVisualStyle(values: AnchorValues): CSSProperties { return { "--anchor-min-x": `${values.anchorMinX * 100}%`, "--anchor-min-y": `${values.anchorMinY * 100}%`, "--anchor-max-x": `${values.anchorMaxX * 100}%`, "--anchor-max-y": `${values.anchorMaxY * 100}%`, "--pivot-x": `${values.pivotX * 100}%`, "--pivot-y": `${values.pivotY * 100}%` } as CSSProperties; }
function clamp01(value: number) { return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)); }
function roundLayout(value: number) { return Number(value.toFixed(2)); }
type RuntimeLayoutField = "anchoredPositionX" | "anchoredPositionY" | "sizeDeltaX" | "sizeDeltaY";
function getRuntimeLayoutValues(node: UINode) {
  return {
    anchoredPositionX: node.anchorOffsetX,
    anchoredPositionY: node.anchorOffsetY,
    sizeDeltaX: node.sizeDeltaX,
    sizeDeltaY: node.sizeDeltaY,
  };
}
function getLayoutParent(node: UINode) { return node.parentId ? nodes.value.find((item) => item.id === node.parentId) ?? null : null; }
function getLayoutParentSize(node: UINode) { const parent = getLayoutParent(node); return parent ? { width: parent.width, height: parent.height } : { width: canvasWidth.value, height: canvasHeight.value }; }
function getAnchorReference(node: UINode) { const parentSize = getLayoutParentSize(node); return { x: ((1 - node.pivotX) * node.anchorMinX + node.pivotX * node.anchorMaxX) * parentSize.width, y: ((1 - node.pivotY) * node.anchorMinY + node.pivotY * node.anchorMaxY) * parentSize.height }; }
function rebaseNodeLayout(node: UINode) { const reference = getAnchorReference(node); const parentSize = getLayoutParentSize(node); node.anchorOffsetX = roundLayout(node.x - reference.x); node.anchorOffsetY = roundLayout(node.y - reference.y); node.sizeDeltaX = roundLayout(node.width - (node.anchorMaxX - node.anchorMinX) * parentSize.width); node.sizeDeltaY = roundLayout(node.height - (node.anchorMaxY - node.anchorMinY) * parentSize.height); }
function applyNodeLayout(node: UINode) { const reference = getAnchorReference(node); const parentSize = getLayoutParentSize(node); node.x = roundLayout(reference.x + node.anchorOffsetX); node.y = roundLayout(reference.y + node.anchorOffsetY); node.width = roundLayout(Math.max(1, (node.anchorMaxX - node.anchorMinX) * parentSize.width + node.sizeDeltaX)); node.height = roundLayout(Math.max(1, (node.anchorMaxY - node.anchorMinY) * parentSize.height + node.sizeDeltaY)); }
function getHierarchyOrder() { const ordered: UINode[] = []; const visited = new Set<string>(); const visit = (node: UINode) => { if (visited.has(node.id)) return; visited.add(node.id); ordered.push(node); nodes.value.filter((child) => child.parentId === node.id).forEach(visit); }; nodes.value.filter((node) => node.parentId === null).forEach(visit); nodes.value.forEach(visit); return ordered; }
function getCanvasRenderOrder() { const ordered: UINode[] = []; const visited = new Set<string>(); const visit = (node: UINode) => { if (visited.has(node.id)) return; visited.add(node.id); ordered.push(node); nodes.value.filter((child) => child.parentId === node.id).slice().reverse().forEach(visit); }; nodes.value.filter((node) => node.parentId === null).slice().reverse().forEach(visit); nodes.value.slice().reverse().forEach(visit); return ordered; }
function reparentNode(node: UINode, requestedParentId: string | null, usePreview = false) {
  const root = rootContainer.value;
  if (!root || node.id === root.id) return false;
  const nextParent = nodes.value.find(item => item.id === (requestedParentId ?? root.id));
  if (!nextParent || nextParent.id === node.id || isDescendant(nextParent.id, node.id)) return false;
  if (node.parentId === nextParent.id) return true;
  // Project repair uses setup poses; interactive drops preserve the currently displayed frame.
  const pose = usePreview ? previewNode(node) : node;
  const parentPose = usePreview ? previewNode(nextParent) : nextParent;
  const worlds = usePreview ? previewWorldTransforms.value : worldTransforms.value;
  const world = worlds.get(node.id), parentWorld = worlds.get(nextParent.id);
  const local = world && parentWorld && boneAttachmentTransform(world, parentWorld);
  if (!local || ![local.offset.x, local.offset.y, local.rotation, local.scaleX, local.scaleY].every(Number.isFinite)) {
    timelineEditNotice.value = "无法保持控件外观：新父级含零缩放，或换父级会产生无法表示的斜切。此次层级拖拽已取消。";
    return false;
  }
  const fields = {
    anchoredPositionX: parentPose.pivotX * parentPose.width + local.offset.x
      - ((1 - pose.pivotX) * pose.anchorMinX + pose.pivotX * pose.anchorMaxX) * parentPose.width,
    anchoredPositionY: parentPose.pivotY * parentPose.height + local.offset.y
      - ((1 - pose.pivotY) * pose.anchorMinY + pose.pivotY * pose.anchorMaxY) * parentPose.height,
    sizeDeltaX: pose.width - (pose.anchorMaxX - pose.anchorMinX) * parentPose.width,
    sizeDeltaY: pose.height - (pose.anchorMaxY - pose.anchorMinY) * parentPose.height,
    localRotationZ: local.rotation, localScaleX: local.scaleX, localScaleY: local.scaleY,
  };
  if (usePreview && !keyframeTracks.value.length && tweenTracks.value.some(track => track.nodeId === node.id && track.fieldKey in fields)) {
    timelineEditNotice.value = "此控件仍使用旧版 Clip 变换轨道，请先转换为关键帧后再调整父级；此次拖拽已取消。";
    return false;
  }
  const oldWidth = node.width, oldHeight = node.height;
  node.parentId = nextParent.id;
  if (usePreview) playing.value = false;
  // Preserve anchors, pivot, content and dimensions. Only compensate local transform/layout.
  // Existing keyed fields are compensated at the current playhead, not overwritten by preview.
  for (const [key, value] of Object.entries(fields)) {
    if (usePreview && hasAnimatedField(key, node.id)) writeAnimatedValue(node, key, value);
    else {
      const field = getTweenableField(node.type, key)!;
      (node as unknown as Record<string, unknown>)[field.modelKey] = value;
    }
  }
  applyNodeLayout(node);
  if (node.width !== oldWidth || node.height !== oldHeight) applyDescendantLayouts(node.id);
  timelineEditNotice.value = "已调整父级，保持当前画布位置、大小和旋转；局部变换已补偿。";
  return true;
}
function placeNodeRelative(node: UINode, target: UINode, mode: "before" | "after") { const root = rootContainer.value; if (!root || node.id === root.id || node.id === target.id) return false; const parentId = target.id === root.id ? root.id : target.parentId ?? root.id; const nextParent = nodes.value.find((item) => item.id === parentId); if (!nextParent || nextParent.id === node.id || isDescendant(nextParent.id, node.id) || !reparentNode(node, nextParent.id, true)) return false; const movingIndex = nodes.value.findIndex((item) => item.id === node.id); if (movingIndex < 0) return false; const [movingNode] = nodes.value.splice(movingIndex, 1); const targetIndex = nodes.value.findIndex((item) => item.id === target.id); const insertIndex = target.id === root.id ? targetIndex + 1 : targetIndex + (mode === "after" ? 1 : 0); nodes.value.splice(Math.max(0, insertIndex), 0, movingNode); return true; }
function ensureSingleRootContainer() { let root = nodes.value.find((node) => node.type === "container" && node.parentId === null) ?? nodes.value.find((node) => node.type === "container"); if (!root) { root = makeRootContainer(canvasWidth.value, canvasHeight.value); nodes.value.unshift(root); } if (root.parentId !== null) { const world = worldTransforms.value.get(root.id); root.parentId = null; root.x = roundLayout(world?.x ?? root.x); root.y = roundLayout(world?.y ?? root.y); rebaseNodeLayout(root); } nodes.value.filter((node) => node.id !== root.id && (!node.parentId || !nodes.value.some((parent) => parent.id === node.parentId))).forEach((node) => reparentNode(node, root.id)); }
function updateHierarchyDropTarget(clientX: number, clientY: number, draggedNode: UINode) { hierarchyDrag.value.pointerX = clientX; hierarchyDrag.value.pointerY = clientY; const tree = hierarchyTree.value; const root = rootContainer.value; if (!tree || !root) return; const treeRect = tree.getBoundingClientRect(); if (clientX < treeRect.left || clientX > treeRect.right || clientY < treeRect.top || clientY > treeRect.bottom) { hierarchyDrag.value.dropTargetId = null; hierarchyDrag.value.dropParentId = null; hierarchyDrag.value.dropMode = null; hierarchyDrag.value.dropLabel = "移回层级区域后释放"; return; } const row = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>(".tree-row[data-node-id]"); const hoveredNode = row?.dataset.nodeId ? nodes.value.find((node) => node.id === row.dataset.nodeId) : null; if (!row || !hoveredNode) { hierarchyDrag.value.dropTargetId = root.id; hierarchyDrag.value.dropParentId = root.id; hierarchyDrag.value.dropMode = "inside"; hierarchyDrag.value.dropLabel = `放到根层级 ${root.name}`; return; } const rowRect = row.getBoundingClientRect(); const ratioY = (clientY - rowRect.top) / Math.max(1, rowRect.height); let mode: Exclude<HierarchyDropMode, null> = ratioY < 0.27 ? "before" : ratioY > 0.73 ? "after" : "inside"; if (hoveredNode.id === draggedNode.id) { hierarchyDrag.value.dropTargetId = null; hierarchyDrag.value.dropParentId = null; hierarchyDrag.value.dropMode = null; hierarchyDrag.value.dropLabel = "不能放到自身"; return; } if (mode === "inside") { if (isDescendant(hoveredNode.id, draggedNode.id)) { hierarchyDrag.value.dropTargetId = null; hierarchyDrag.value.dropParentId = null; hierarchyDrag.value.dropMode = null; hierarchyDrag.value.dropLabel = "不能归属到自己的子级"; return; } hierarchyDrag.value.dropTargetId = hoveredNode.id; hierarchyDrag.value.dropParentId = hoveredNode.id; hierarchyDrag.value.dropMode = mode; hierarchyDrag.value.dropLabel = `成为 ${hoveredNode.name} 的子级`; return; } const nextParent = hoveredNode.id === root.id ? root : nodes.value.find((node) => node.id === hoveredNode.parentId) ?? root; if (nextParent.id === draggedNode.id || isDescendant(nextParent.id, draggedNode.id)) { hierarchyDrag.value.dropTargetId = null; hierarchyDrag.value.dropParentId = null; hierarchyDrag.value.dropMode = null; hierarchyDrag.value.dropLabel = "不能移动到自己的子级之间"; return; } if (hoveredNode.id === root.id) mode = "after"; hierarchyDrag.value.dropTargetId = hoveredNode.id; hierarchyDrag.value.dropParentId = nextParent.id; hierarchyDrag.value.dropMode = mode; hierarchyDrag.value.dropLabel = hoveredNode.id === root.id ? "放到根层级顶部" : `移到 ${hoveredNode.name} ${mode === "before" ? "上方" : "下方"}`; }
let cancelHierarchyPress: (() => void) | null = null;
function startHierarchyPress(event: PointerEvent, node: UINode) { if (event.button !== 0 || boneCreateMode.value) return; selectedId.value = node.id; if (node.id === rootContainer.value?.id) return; cancelHierarchyPress?.(); const startX = event.clientX; const startY = event.clientY; let activated = false; let timer = window.setTimeout(() => { activated = true; hierarchyDrag.value = { nodeId: node.id, active: true, pointerX: startX, pointerY: startY, dropTargetId: null, dropParentId: node.parentId ?? rootContainer.value?.id ?? null, dropMode: null, dropLabel: `当前归属：${getLayoutParent(node)?.name ?? rootContainer.value?.name ?? "根容器"}` }; updateHierarchyDropTarget(startX, startY, node); }, 50); const cleanup = () => { window.clearTimeout(timer); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", cancel); cancelHierarchyPress = null; }; const move = (next: PointerEvent) => { if (!activated && Math.hypot(next.clientX - startX, next.clientY - startY) > 7) { cleanup(); return; } if (activated) { next.preventDefault(); updateHierarchyDropTarget(next.clientX, next.clientY, node); } }; const finish = (next: PointerEvent) => { if (activated) { updateHierarchyDropTarget(next.clientX, next.clientY, node); const targetId = hierarchyDrag.value.dropTargetId; const mode = hierarchyDrag.value.dropMode; const target = targetId ? nodes.value.find((item) => item.id === targetId) : null; const changed = target && mode === "inside" ? reparentNode(node, target.id, true) : target && (mode === "before" || mode === "after") ? placeNodeRelative(node, target, mode) : false; if (changed) { const expandId = mode === "inside" ? target?.id : hierarchyDrag.value.dropParentId; if (expandId) { const nextCollapsed = new Set(collapsed.value); nextCollapsed.delete(expandId); collapsed.value = nextCollapsed; } } } cleanup(); hierarchyDrag.value = emptyHierarchyDrag(); }; const cancel = () => { cleanup(); hierarchyDrag.value = emptyHierarchyDrag(); }; cancelHierarchyPress = cleanup; window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", cancel); }
function applyDescendantLayouts(parentId: string) { nodes.value.filter((node) => node.parentId === parentId).forEach((child) => { applyNodeLayout(child); applyDescendantLayouts(child.id); }); }
function propertyGroupLabel(group: PropertyGroup) {
  if (group === "control") return `${selectedControlDefinition.value.label}参数`;
  return { transform: "变换", image: "图片设置", creation: "创建设置", editor: "编辑设置" }[group];
}
function canPasteSelectedPropertyGroup(group: PropertyGroup) {
  const node = selectedNode.value;
  return Boolean(node && canPastePropertyGroup(node, group, propertyClipboard.value));
}
function propertyPasteHint(group: PropertyGroup) {
  const clipboard = propertyClipboard.value;
  if (!clipboard) return "请先复制此分组的属性";
  if (clipboard.group !== group) return "请先复制相同分组的属性";
  if (!canPasteSelectedPropertyGroup(group)) return "此分组只支持同类型控件之间粘贴";
  return `粘贴已复制的${propertyGroupLabel(group)}属性`;
}
function reportPropertyAction(group: PropertyGroup, action: string) {
  if (!selectedNode.value) return;
  propertyActionFeedback.value = { nodeId: selectedNode.value.id, message: `${action}${propertyGroupLabel(group)}属性` };
}
function copySelectedPropertyGroup(group: PropertyGroup) {
  const node = inspectorNode.value;
  if (!node) return;
  const snapshot = capturePropertyGroup(node, group);
  if (!snapshot) return;
  propertyClipboard.value = snapshot;
  reportPropertyAction(group, "已复制");
}
function applySelectedPropertyLayout(group: PropertyGroup, node: UINode) {
  if (group !== "transform") return;
  applyNodeLayout(node);
  applyDescendantLayouts(node.id);
}
function commitSelectedPropertyGroup(group: PropertyGroup, node: UINode, before: PropertyGroupSnapshot, after: PropertyGroupSnapshot) {
  const fields = getTweenableFields(node.type);
  const changes = Object.entries(after.values)
    .filter(([key, value]) => JSON.stringify(before.values[key]) !== JSON.stringify(value))
    .map(([key, value]) => ({ key, value, field: fields.find(field =>
      group === "transform" ? field.source === "base" && field.modelKey === key : (group === "control" || group === "image") && field.source === "properties" && field.modelKey === key) }));
  // Preflight before mutating anything: a missing setup default cannot become a native keyframe value.
  for (const change of changes) {
    if (!change.field || !hasAnimatedField(change.field.fieldKey, node.id)) continue;
    const valid = change.field.valueKind === "number"
      ? typeof change.value === "number" && Number.isFinite(change.value)
      : Boolean(normalizeColorRGBA(change.value));
    if (!valid) {
      timelineEditNotice.value = `「${change.field.label}」已加入动画，不能设为未设置或无效值；请先填写有效数值或删除该属性轨道。`;
      return false;
    }
  }
  // Record first while all relative baselines still refer to the untouched setup model.
  for (const change of changes) {
    if (change.field && hasAnimatedField(change.field.fieldKey, node.id)) writeAnimatedValue(node, change.field.fieldKey, change.value as UITweenValue);
  }
  const target = group === "control" || group === "image" ? node.properties as unknown as Record<string, unknown> : node as unknown as Record<string, unknown>;
  for (const change of changes) {
    if (!change.field || !hasAnimatedField(change.field.fieldKey, node.id)) target[change.key] = change.value;
  }
  applySelectedPropertyLayout(group, node);
  return true;
}
function stageSelectedPropertyGroup(group: PropertyGroup, action: "reset" | "paste") {
  const node = selectedNode.value;
  const display = inspectorNode.value;
  if (!node || !display) return false;
  const draft = JSON.parse(JSON.stringify(display)) as UINode;
  const before = capturePropertyGroup(draft, group);
  if (!before || !(action === "reset" ? resetPropertyGroup(draft, group) : pastePropertyGroup(draft, group, propertyClipboard.value))) return false;
  const after = capturePropertyGroup(draft, group);
  return Boolean(after && commitSelectedPropertyGroup(group, node, before, after));
}
function resetSelectedPropertyGroup(group: PropertyGroup) {
  if (!stageSelectedPropertyGroup(group, "reset")) return;
  reportPropertyAction(group, "已重置");
}
function pasteSelectedPropertyGroup(group: PropertyGroup) {
  if (!stageSelectedPropertyGroup(group, "paste")) return;
  reportPropertyAction(group, "已粘贴");
}
let imageSelectionVersion = 0;
async function selectImageAsset(assetId: number | null) {
  const node = selectedNode.value;
  if (!node || node.type !== "image") return;
  const version = ++imageSelectionVersion;
  const asset = getImageAsset(assetId);
  const previousId = node.properties.imageId;
  if (asset) await loadSpriteMetadata(asset);
  if (version !== imageSelectionVersion || selectedNode.value !== node || node.properties.imageId !== previousId) return;
  selectedProperties.value = { ...selectedProperties.value, imageSource: "staticReference", imageId: assetId, imageType: isStretchable(asset?.metadata) ? "stretch" : "basic" };
}
async function resetSelectedImageSize() {
  const node = selectedNode.value;
  const asset = node?.type === "image" ? getImageAsset(node.properties.imageId) : null;
  if (!node || !asset?.src || asset.missing) return;
  const metadata = await loadSpriteMetadata(asset);
  if (selectedNode.value !== node || node.type !== "image" || node.properties.imageId !== asset.id) return;
  if (metadata) { updateGeometry("width", metadata.width); updateGeometry("height", metadata.height); }
  else {
    const image = new Image();
    image.onload = () => { if (selectedNode.value === node && node.properties.imageId === asset.id) { updateGeometry("width", image.naturalWidth); updateGeometry("height", image.naturalHeight); } };
    image.src = asset.src;
  }
}
function updateGeometry(field: "x" | "y" | "width" | "height", value: number) { if (tryKeyframeGeometry(field, value)) return; const node = selectedNode.value; if (!node || !Number.isFinite(value)) return; if (field === "x" || field === "y") { const currentWorld = worldTransforms.value.get(node.id) ?? { x: node.x, y: node.y, matrix: localMatrix(node) }; const targetWorldX = field === "x" ? value : currentWorld.x; const targetWorldY = field === "y" ? value : currentWorld.y; const parent = getLayoutParent(node); if (parent) { const parentWorld = worldTransforms.value.get(parent.id) ?? { x: parent.x, y: parent.y, matrix: localMatrix(parent) }; const localOffset = inverseTransformVector(parentWorld.matrix, targetWorldX - parentWorld.x, targetWorldY - parentWorld.y); node.x = roundLayout(parent.pivotX * parent.width + localOffset.x); node.y = roundLayout(parent.pivotY * parent.height + localOffset.y); } else { node.x = roundLayout(targetWorldX); node.y = roundLayout(targetWorldY); } rebaseNodeLayout(node); return; } node[field] = Math.max(1, value); rebaseNodeLayout(node); applyDescendantLayouts(node.id); }
function applyAnchorPreset(id: string) {
  const node = selectedNode.value;
  const display = inspectorNode.value;
  const preset = anchorPresets.find(item => item.id === id);
  if (!node || !display || !preset) return;
  const draft = JSON.parse(JSON.stringify(display)) as UINode;
  const before = capturePropertyGroup(draft, "transform")!;
  draft.anchorMinX = preset.anchorMinX;
  draft.anchorMinY = preset.anchorMinY;
  draft.anchorMaxX = preset.anchorMaxX;
  draft.anchorMaxY = preset.anchorMaxY;
  const parent = draft.parentId ? previewNodeMap.value.get(draft.parentId) : null;
  const parentWidth = parent?.width ?? canvasWidth.value, parentHeight = parent?.height ?? canvasHeight.value;
  // Preserve the displayed pose using the displayed parent's size, not the setup layout.
  draft.anchorOffsetX = roundLayout(draft.x - ((1 - draft.pivotX) * draft.anchorMinX + draft.pivotX * draft.anchorMaxX) * parentWidth);
  draft.anchorOffsetY = roundLayout(draft.y - ((1 - draft.pivotY) * draft.anchorMinY + draft.pivotY * draft.anchorMaxY) * parentHeight);
  draft.sizeDeltaX = roundLayout(draft.width - (draft.anchorMaxX - draft.anchorMinX) * parentWidth);
  draft.sizeDeltaY = roundLayout(draft.height - (draft.anchorMaxY - draft.anchorMinY) * parentHeight);
  const after = capturePropertyGroup(draft, "transform")!;
  if (commitSelectedPropertyGroup("transform", node, before, after)) anchorMenuOpen.value = false;
}
function onAnchorPresetSelect(event: Event) { applyAnchorPreset((event.target as HTMLSelectElement).value); }
function updateAnchor(bound: "min" | "max", axis: "x" | "y", value: number) { const fieldKey = `anchor${bound === "min" ? "Min" : "Max"}${axis.toUpperCase()}`; if (selectedNode.value && hasAnimatedField(fieldKey)) { writeAnimatedValue(selectedNode.value, fieldKey, clamp01(value)); return; } const node = selectedNode.value; if (!node) return; const next = clamp01(value); if (axis === "x") { if (bound === "min") node.anchorMinX = Math.min(next, node.anchorMaxX); else node.anchorMaxX = Math.max(next, node.anchorMinX); } else { if (bound === "min") node.anchorMinY = Math.min(next, node.anchorMaxY); else node.anchorMaxY = Math.max(next, node.anchorMinY); } rebaseNodeLayout(node); }
function updatePivot(axis: "x" | "y", value: number) { const fieldKey = axis === "x" ? "pivotX" : "pivotY"; if (selectedNode.value && hasAnimatedField(fieldKey)) { writeAnimatedValue(selectedNode.value, fieldKey, clamp01(value)); return; } const node = selectedNode.value; if (!node) return; const next = clamp01(value); const deltaX = axis === "x" ? (next - node.pivotX) * node.width : 0; const deltaY = axis === "y" ? (next - node.pivotY) * node.height : 0; const shift = transformVector(localMatrix(node), deltaX, deltaY); node.x = roundLayout(node.x + shift.x); node.y = roundLayout(node.y + shift.y); if (axis === "x") node.pivotX = next; else node.pivotY = next; rebaseNodeLayout(node); }
function updateRuntimeLayoutValue(field: RuntimeLayoutField, value: number | null) {
  const node = selectedNode.value;
  if (!node || value === null || !Number.isFinite(value)) return;
  if (hasAnimatedField(field)) { writeAnimatedValue(node, field, value); return; }
  if (field === "anchoredPositionX") node.anchorOffsetX = value;
  else if (field === "anchoredPositionY") node.anchorOffsetY = value;
  else if (field === "sizeDeltaX") node.sizeDeltaX = value;
  else node.sizeDeltaY = value;
  applyNodeLayout(node);
  applyDescendantLayouts(node.id);
}
function getImageAsset(imageId: number | null) { return imageId == null ? null : imageAssetById.get(imageId) ?? null; }
function safeColor(value: unknown, fallback: ColorRGBA) { const color = value as Partial<ColorRGBA> | null; return color && Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b) ? color as ColorRGBA : fallback; }
function textRenderStyle(node: UINodeOf<"text"> | UINodeOf<"textWindow">): CSSProperties {
  const displayNode = previewNode(node);
  const properties = displayNode.properties;
  const horizontal = properties.horizontalAlignment === "left" ? "flex-start" : properties.horizontalAlignment === "right" ? "flex-end" : "center";
  const vertical = properties.verticalAlignment === "top" ? "flex-start" : properties.verticalAlignment === "bottom" ? "flex-end" : "center";
  const textAlign = properties.horizontalAlignment === "left" ? "left" : properties.horizontalAlignment === "right" ? "right" : "center";
  const configuredSize = properties.fontSize ?? 20;
  const minimumSize = properties.minimumFontSize ?? 1;
  const adaptiveSize = Math.max(minimumSize, Math.min(configuredSize, displayNode.height * 0.72, displayNode.width / Math.max(2, properties.text.length * 0.56)));
  const fontSize = properties.adaptiveFontSize ? adaptiveSize : configuredSize;
  return {
    color: colorToCss(safeColor(properties.fontColor, editorTypeColors[displayNode.type])),
    fontSize: `${fontSize}px`,
    justifyContent: horizontal,
    alignItems: vertical,
    // Flex positions the text block; text-align also aligns each wrapped/explicit line.
    textAlign,
    WebkitTextStroke: properties.enableOutline ? `1px ${colorToCss(safeColor(properties.outlineColor, colorFromHex("#333333", 0.2)))}` : undefined,
  };
}
function nodeStyle(node: UINode): CSSProperties {
  const displayNode = previewNode(node);
  const world = previewWorldTransforms.value.get(node.id) ?? { x: displayNode.x, y: displayNode.y, matrix: localMatrix(displayNode) };
  const isText = displayNode.type === "text" || displayNode.type === "textWindow";
  const isContainer = displayNode.type === "container";
  const hasVisual = displayNode.type === "image" || displayNode.type === "primitive" || displayNode.type === "reference" && controlTemplateByIndex.value.has(displayNode.properties.referencedPrefabIndex ?? -1);
  const typeColor = editorTypeColors[displayNode.type];
  const borderColor = isContainer || hasVisual ? "transparent" : isText ? colorToCss(safeColor(displayNode.properties.fontColor, typeColor)) : colorToCss(typeColor);
  const backgroundColor = isContainer || hasVisual ? "transparent" : isText ? colorToCss(safeColor(displayNode.properties.bgColor, colorFromHex("#ffffff", 0))) : colorToCss(typeColor, 0.12);
  return { width: `${displayNode.width}px`, height: `${displayNode.height}px`, left: `${world.x - displayNode.width * displayNode.pivotX}px`, top: `${canvasHeight.value - world.y - displayNode.height * (1 - displayNode.pivotY)}px`, transform: `matrix(${world.matrix.a}, ${-world.matrix.b}, ${-world.matrix.c}, ${world.matrix.d}, 0, 0)`, transformOrigin: `${displayNode.pivotX * 100}% ${(1 - displayNode.pivotY) * 100}%`, borderColor, backgroundColor, color: colorToCss(typeColor) };
}
function canvasOverlayPoint(x: number, y: number) {
  return { x: panX.value + (x - canvasWidth.value / 2) * zoom.value, y: panY.value + (canvasHeight.value / 2 - y) * zoom.value };
}
function canvasClientPoint(x: number, y: number) {
  const viewport = viewportElement.value;
  if (!viewport) return null;
  const rect = viewport.getBoundingClientRect();
  const offset = canvasOverlayPoint(x, y);
  return { x: rect.left + viewport.clientLeft + viewport.clientWidth / 2 + offset.x, y: rect.top + viewport.clientTop + viewport.clientHeight / 2 + offset.y };
}
function screenAxis(matrix: Matrix2D, axis: "x" | "y") {
  const x = axis === "x" ? matrix.a : matrix.c;
  const y = axis === "x" ? -matrix.b : -matrix.d;
  const length = Math.hypot(x, y);
  return length > 0.000001 ? { x: x / length, y: y / length } : { x: axis === "x" ? 1 : 0, y: axis === "y" ? -1 : 0 };
}
const transformGizmo = computed(() => {
  const node = selectedNode.value;
  if (boneCreateMode.value) return null;
  if (!node || node.locked || canvasTool.value === "move" || !renderNodes.value.some(item => item.id === node.id)) return null;
  const pose = previewNode(node);
  const world = previewWorldTransforms.value.get(node.id);
  if (!world) return null;
  const point = canvasOverlayPoint(world.x, world.y);
  const xAxis = screenAxis(world.matrix, "x"), yAxis = screenAxis(world.matrix, "y");
  const topOffset = transformVector(world.matrix, (0.5 - pose.pivotX) * pose.width, (1 - pose.pivotY) * pose.height);
  const top = { x: topOffset.x * zoom.value, y: -topOffset.y * zoom.value };
  return {
    style: { left: `calc(50% + ${point.x}px)`, top: `calc(50% + ${point.y}px)` },
    top,
    rotationHandle: { x: top.x + yAxis.x * 32, y: top.y + yAxis.y * 32 },
    xAxis: { x: xAxis.x * 58, y: xAxis.y * 58 },
    scaleAxes: [{ id: "x" as const, x: xAxis.x * 58, y: xAxis.y * 58 }, { id: "y" as const, x: yAxis.x * 58, y: yAxis.y * 58 }],
  };
});
const boneLengthHandle = computed<CSSProperties | null>(() => {
  const node = selectedNode.value;
  if (boneCreateMode.value) return null;
  if (!node || node.locked || !renderContainerDirections.value.some(guide => guide.id === node.id)) return null;
  const world = previewWorldTransforms.value.get(node.id);
  if (!world || Math.hypot(world.matrix.a, world.matrix.b) < 0.000001) return null;
  const length = selectedDirectionArrowLength.value;
  const point = canvasOverlayPoint(world.x + world.matrix.a * length, world.y + world.matrix.b * length);
  const angle = Math.atan2(-world.matrix.b, world.matrix.a) * 180 / Math.PI;
  const cursors = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
  return { left: `calc(50% + ${point.x}px)`, top: `calc(50% + ${point.y}px)`, cursor: cursors[((Math.round(angle / 45) % 4) + 4) % 4] };
});
function startBoneLengthDrag(event: PointerEvent) {
  if (event.button === 1) { startCanvasPan(event); return; }
  const node = selectedNode.value;
  if (event.button !== 0 || !node || node.type !== "container" || !boneLengthHandle.value) return;
  playing.value = false;
  event.preventDefault();
  const world = previewWorldTransforms.value.get(node.id)!;
  const { a, b } = world.matrix;
  const axisLengthSquared = a * a + b * b;
  const length = selectedDirectionArrowLength.value;
  pointerDrag(event, (dx, dy) => {
    // Project onto the displayed bone axis; perpendicular motion leaves length unchanged.
    const next = normalizeDirectionArrowLength(length + (dx * a - dy * b) / axisLengthSquared);
    if (next !== normalizeDirectionArrowLength(node.editor?.directionArrowLength)) node.editor = { ...node.editor, directionArrowLength: next };
  });
}
function selectCanvasTool(tool: CanvasTool) {
  stopCanvasNodeDrag?.();
  boneCreateMode.value = false;
  canvasTool.value = tool;
}
function toggleBoneTools() {
  boneToolsEnabled.value = !boneToolsEnabled.value;
  if (!boneToolsEnabled.value) {
    stopCanvasNodeDrag?.();
    boneCreateMode.value = false;
    boneDraft.value = null;
    clearBoneHover();
  }
}
function toggleBoneCreateMode() {
  stopCanvasNodeDrag?.();
  boneCreateMode.value = !boneCreateMode.value;
  addMenuOpen.value = false;
  if (boneCreateMode.value) {
    playing.value = false;
    boneParentId.value = rootContainer.value?.id ?? null;
    selectedId.value = boneParentId.value;
  }
}
function bonePointFromClient(clientX: number, clientY: number): BonePoint | null {
  const origin = canvasClientPoint(0, 0);
  return origin ? { x: (clientX - origin.x) / zoom.value, y: (origin.y - clientY) / zoom.value } : null;
}
function boneAtPoint(clientX: number, clientY: number) {
  const point = { x: clientX, y: clientY };
  return renderNodes.value.slice().reverse().filter(node => node.type === "container").map(node => {
    const world = previewWorldTransforms.value.get(node.id)!;
    const length = normalizeDirectionArrowLength(node.editor?.directionArrowLength);
    const start = canvasClientPoint(world.x, world.y);
    const end = canvasClientPoint(world.x + world.matrix.a * length, world.y + world.matrix.b * length);
    return { node, distance: start && end ? distanceToBone(point, start, end) : Infinity };
  }).filter(hit => hit.distance <= 9).sort((a, b) => a.distance - b.distance)[0]?.node ?? null;
}
function createBoneFromDrag(parent: UINode, start: BonePoint, end: BonePoint) {
  if (!nodes.value.includes(parent) || parent.locked || !isVisibleInHierarchy(parent)) return null;
  const pose = previewNode(parent), world = previewWorldTransforms.value.get(parent.id);
  const geometry = world && boneGeometry(start, end, world);
  if (!geometry) { timelineEditNotice.value = "拖拽距离过短，或父级缩放为 0，无法创建骨骼。"; return null; }
  let index = 1;
  while (nodes.value.some(node => node.name === `骨骼_${index}`)) index++;
  const node = makeNode("container", `骨骼_${index}`, {
    parentId: parent.id, pivotX: 0, pivotY: 0.5,
    anchorMinX: pose.pivotX, anchorMaxX: pose.pivotX, anchorMinY: pose.pivotY, anchorMaxY: pose.pivotY,
    anchorOffsetX: geometry.offset.x, anchorOffsetY: geometry.offset.y,
    width: geometry.length, height: BONE_THICKNESS, sizeDeltaX: geometry.length, sizeDeltaY: BONE_THICKNESS,
    rotation: geometry.rotation, editor: { directionArrowLength: geometry.length },
  });
  nodes.value.push(node);
  applyNodeLayout(node);
  collapsed.value = new Set([...collapsed.value].filter(id => id !== parent.id));
  boneParentId.value = node.id;
  selectHierarchyNode(node);
  timelineEditNotice.value = `已创建 ${node.name}，下一根将作为它的子级。`;
  return node;
}
function attachControlToBone(node: UINode) {
  const parent = boneParent.value;
  if (!parent || node.id === rootContainer.value?.id || node.id === parent.id || isDescendant(parent.id, node.id)) {
    timelineEditNotice.value = "不能把根容器、自身或骨骼的祖先挂到当前骨骼下。"; return false;
  }
  if (node.locked || parent.locked) { timelineEditNotice.value = "请先解锁控件和父骨骼。"; return false; }
  if (node.parentId === parent.id) return true;
  const pose = previewNode(node), parentPose = previewNode(parent);
  const world = previewWorldTransforms.value.get(node.id), parentWorld = previewWorldTransforms.value.get(parent.id);
  const local = world && parentWorld && boneAttachmentTransform(world, parentWorld);
  if (!local) { timelineEditNotice.value = "当前父级含零缩放或会产生斜切，无法保持控件外观；请先调整父级缩放。"; return false; }
  node.parentId = parent.id;
  node.width = pose.width; node.height = pose.height;
  node.anchorMinX = node.anchorMaxX = parentPose.pivotX;
  node.anchorMinY = node.anchorMaxY = parentPose.pivotY;
  node.anchorOffsetX = local.offset.x; node.anchorOffsetY = local.offset.y;
  node.sizeDeltaX = pose.width; node.sizeDeltaY = pose.height;
  node.rotation = local.rotation; node.scaleX = local.scaleX; node.scaleY = local.scaleY;
  applyNodeLayout(node); applyDescendantLayouts(node.id);
  // Existing animated fields must use the new parent's coordinates at the current frame too.
  for (const [field, value] of Object.entries({ anchoredPositionX: local.offset.x, anchoredPositionY: local.offset.y,
    sizeDeltaX: pose.width, sizeDeltaY: pose.height, localRotationZ: local.rotation, localScaleX: local.scaleX, localScaleY: local.scaleY,
    anchorMinX: parentPose.pivotX, anchorMaxX: parentPose.pivotX, anchorMinY: parentPose.pivotY, anchorMaxY: parentPose.pivotY })) {
    if (hasAnimatedField(field, node.id)) writeAnimatedValue(node, field, value);
  }
  collapsed.value = new Set([...collapsed.value].filter(id => id !== parent.id));
  selectedId.value = parent.id;
  timelineEditNotice.value = `已将 ${node.name} 挂到 ${parent.name} 下。`;
  return true;
}
function boneAttachTargetAtPoint(x: number, y: number) {
  const parent = boneParent.value;
  return parent ? canvasNodesAtPoint(x, y).find(node => node.id !== parent.id && node.id !== rootContainer.value?.id) ?? null : null;
}
function captureBonePointer(event: PointerEvent) {
  if (!boneCreateMode.value || event.button !== 0) return;
  event.stopPropagation();
  startBoneCreatePress(event);
}
function startBoneCreatePress(event: PointerEvent) {
  stopCanvasNodeDrag?.();
  const parent = boneParent.value, start = bonePointFromClient(event.clientX, event.clientY);
  if (!parent || !start) return;
  playing.value = false;
  event.preventDefault();
  const pointerId = event.pointerId, ctrl = event.ctrlKey;
  let moved = false;
  const exceedsThreshold = (next: PointerEvent) => Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) >= 4;
  const cleanup = () => {
    boneDraft.value = null;
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel); window.removeEventListener("blur", cleanup);
    if (stopCanvasNodeDrag === cleanup) stopCanvasNodeDrag = null;
  };
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    moved ||= exceedsThreshold(next);
    const end = bonePointFromClient(next.clientX, next.clientY);
    if (moved && !ctrl && end) boneDraft.value = { start, end, parentId: parent.id };
  };
  const finish = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    const end = bonePointFromClient(next.clientX, next.clientY);
    cleanup();
    if (!boneCreateMode.value || !end) return;
    if (moved || exceedsThreshold(next)) { if (!ctrl) createBoneFromDrag(parent, start, end); return; }
    if (ctrl) {
      const target = boneAttachTargetAtPoint(next.clientX, next.clientY);
      if (target) attachControlToBone(target);
    } else {
      const target = boneAtPoint(next.clientX, next.clientY);
      if (target) selectHierarchyNode(target);
    }
  };
  const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(); };
  stopCanvasNodeDrag = cleanup;
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", cancel); window.addEventListener("blur", cleanup);
}
function handleBoneCreateKey(event: KeyboardEvent) {
  if (event.key !== "Escape" || !boneCreateMode.value) return;
  stopCanvasNodeDrag?.(); boneCreateMode.value = false;
}
onMounted(() => window.addEventListener("keydown", handleBoneCreateKey));
onBeforeUnmount(() => window.removeEventListener("keydown", handleBoneCreateKey));
function canvasNodesAtPoint(clientX: number, clientY: number) {
  const origin = canvasClientPoint(0, 0);
  if (!origin) return [];
  const x = (clientX - origin.x) / zoom.value, y = (origin.y - clientY) / zoom.value;
  // Rendering is back-to-front. Hit testing follows the same order, reversed,
  // and uses each preview transform rather than the DOM's topmost event target.
  return renderNodes.value.slice().reverse().filter(node => {
    const world = previewWorldTransforms.value.get(node.id);
    if (!world || Math.abs(world.matrix.a * world.matrix.d - world.matrix.b * world.matrix.c) < 0.000001) return false;
    const pose = previewNode(node);
    const local = inverseTransformVector(world.matrix, x - world.x, y - world.y);
    return local.x >= -pose.width * pose.pivotX && local.x <= pose.width * (1 - pose.pivotX)
      && local.y >= -pose.height * pose.pivotY && local.y <= pose.height * (1 - pose.pivotY);
  });
}
function startCanvasPress(event: PointerEvent) {
  if (event.button === 1) { startCanvasPan(event); return; }
  if (event.button !== 0) return;
  if (boneCreateMode.value) { startBoneCreatePress(event); return; }
  stopCanvasNodeDrag?.();
  event.preventDefault();
  const pointerId = event.pointerId;
  const selected = selectedNode.value;
  const dragTarget = selected && !selected.locked && canvasNodesAtPoint(event.clientX, event.clientY).some(node => node.id === selected.id) ? selected : null;
  let dragged = false;
  const exceedsClickDistance = (next: PointerEvent) => Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) >= 4;
  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cleanup);
    if (stopCanvasNodeDrag === cleanup) stopCanvasNodeDrag = null;
  };
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId || !exceedsClickDistance(next)) return;
    dragged = true;
    if (!dragTarget || selectedId.value !== dragTarget.id) return;
    cleanup();
    startCanvasTransform(event, dragTarget);
    // Apply the threshold-crossing movement too, measured from the original press.
    moveCanvasNodeDrag?.(next);
  };
  const finish = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    cleanup();
    if (dragged || exceedsClickDistance(next)) return;
    const hits = canvasNodesAtPoint(next.clientX, next.clientY);
    const current = hits.findIndex(node => node.id === selectedId.value);
    selectedId.value = hits.length ? hits[(current + 1) % hits.length].id : null;
  };
  const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(); };
  stopCanvasNodeDrag = cleanup;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cleanup);
}
function startCanvasTransform(event: PointerEvent, node: UINode) {
  if (event.button === 1) { startCanvasPan(event); return; }
  if (event.button !== 0) return;
  selectedId.value = node.id;
  if (node.locked) return;
  if (canvasTool.value === "rotate") startCanvasRotation(event, node);
  else if (canvasTool.value === "scale") startCanvasScale(event, node);
  else startMove(event, node);
}
function startCanvasRotation(event: PointerEvent, node: UINode) {
  if (event.button === 1) { startCanvasPan(event); return; }
  if (event.button !== 0 || node.locked) return;
  selectedId.value = node.id;
  playing.value = false;
  const pose = previewNode(node);
  const world = previewWorldTransforms.value.get(node.id);
  if (!world) return;
  const pivot = canvasClientPoint(world.x, world.y);
  if (!pivot) return;
  event.preventDefault();
  const parentMatrix = node.parentId ? previewWorldTransforms.value.get(node.parentId)?.matrix : null;
  const matrix = parentMatrix ?? { a: 1, b: 0, c: 0, d: 1 };
  if (Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 0.000001) return;
  const initialZoom = zoom.value;
  const origin = { x: (event.clientX - pivot.x) / initialZoom, y: (pivot.y - event.clientY) / initialZoom };
  const angleAt = (x: number, y: number) => { const local = inverseTransformVector(matrix, x, y); return Math.atan2(local.y, local.x); };
  let previousAngle: number | null = Math.hypot(origin.x, origin.y) * initialZoom >= 4 ? angleAt(origin.x, origin.y) : null;
  let totalAngle = 0;
  const rotation = pose.rotation;
  pointerDrag(event, (dx, dy) => {
    const x = origin.x + dx, y = origin.y - dy;
    if (Math.hypot(x, y) * initialZoom < 4) return;
    const angle = angleAt(x, y);
    if (previousAngle !== null) {
      // Accumulate short steps so crossing +/-180 degrees never jumps a full turn.
      const step = angle - previousAngle;
      totalAngle += Math.atan2(Math.sin(step), Math.cos(step));
      if (totalAngle !== 0 || step !== 0) writeAnimatedValue(node, "localRotationZ", normalizeRotationAngle(roundLayout(rotation + totalAngle * 180 / Math.PI)));
    }
    previousAngle = angle;
  });
}
function startCanvasScale(event: PointerEvent, node: UINode, axis: "uniform" | "x" | "y" = "uniform") {
  if (event.button === 1) { startCanvasPan(event); return; }
  if (event.button !== 0 || node.locked) return;
  selectedId.value = node.id;
  playing.value = false;
  const pose = previewNode(node);
  const world = previewWorldTransforms.value.get(node.id);
  if (!world) return;
  const pivot = canvasClientPoint(world.x, world.y);
  if (!pivot) return;
  event.preventDefault();
  const scaleX = pose.scaleX, scaleY = pose.scaleY;
  const direction = screenAxis(world.matrix, axis === "y" ? "y" : "x");
  const origin = { x: event.clientX - pivot.x, y: event.clientY - pivot.y };
  const radius = Math.hypot(origin.x, origin.y);
  const initialZoom = zoom.value;
  let changed = false;
  pointerDrag(event, (dx, dy) => {
    const screenX = dx * initialZoom, screenY = dy * initialZoom;
    const ratio = axis !== "uniform" ? 1 + (screenX * direction.x + screenY * direction.y) / 100
      : radius >= 16 ? Math.hypot(origin.x + screenX, origin.y + screenY) / radius : 1 + (screenX - screenY) / 100;
    const factor = Math.max(0.01, ratio);
    if (factor === 1 && !changed) return;
    changed = true;
    if (axis !== "y") writeAnimatedValue(node, "localScaleX", Math.round(scaleX * factor * 10000) / 10000);
    if (axis !== "x") writeAnimatedValue(node, "localScaleY", Math.round(scaleY * factor * 10000) / 10000);
  });
}
let stopCanvasNodeDrag: (() => void) | null = null;
let moveCanvasNodeDrag: ((event: PointerEvent) => void) | null = null;
onBeforeUnmount(() => stopCanvasNodeDrag?.());
function pointerDrag(event: PointerEvent, onMove: (dx: number, dy: number) => void) {
  stopCanvasNodeDrag?.();
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    onMove((next.clientX - startX) / zoom.value, (next.clientY - startY) / zoom.value);
  };
  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    window.removeEventListener("blur", cleanup);
    if (stopCanvasNodeDrag === cleanup) { stopCanvasNodeDrag = null; moveCanvasNodeDrag = null; }
  };
  const finish = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(); };
  stopCanvasNodeDrag = cleanup;
  moveCanvasNodeDrag = move;
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  window.addEventListener("blur", cleanup);
}
function inverseTransformVector(matrix: Matrix2D, x: number, y: number) { const determinant = matrix.a * matrix.d - matrix.b * matrix.c; if (Math.abs(determinant) < 0.000001) return { x: 0, y: 0 }; return { x: (matrix.d * x - matrix.c * y) / determinant, y: (-matrix.b * x + matrix.a * y) / determinant }; }
function handleCanvasWheel(event: WheelEvent) { const viewport = viewportElement.value; if (!viewport) return; const normalizedDelta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1); const previousZoom = zoom.value; const nextZoom = Math.max(0.01, Math.min(1.5, previousZoom * Math.exp(-normalizedDelta * 0.0015))); if (nextZoom === previousZoom) return; const rect = viewport.getBoundingClientRect(); const pointerX = event.clientX - (rect.left + rect.width / 2); const pointerY = event.clientY - (rect.top + rect.height / 2); const ratio = nextZoom / previousZoom; panX.value = roundLayout(panX.value + (pointerX - panX.value) * (1 - ratio)); panY.value = roundLayout(panY.value + (pointerY - panY.value) * (1 - ratio)); zoom.value = nextZoom; }
function startCanvasPan(event: PointerEvent) { if (event.button !== 1) return; event.preventDefault(); event.stopPropagation(); const startX = event.clientX; const startY = event.clientY; const originX = panX.value; const originY = panY.value; isPanning.value = true; const move = (next: PointerEvent) => { panX.value = roundLayout(originX + next.clientX - startX); panY.value = roundLayout(originY + next.clientY - startY); }; const end = () => { isPanning.value = false; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end); }
function handleViewportPointerDown(event: PointerEvent) { startCanvasPress(event); }
function startMove(event: PointerEvent, node: UINode) { if (event.button === 1) { startCanvasPan(event); return; } if (event.button !== 0) return; selectedId.value = node.id; if (node.locked) return; if (startAnimatedCanvasMove(event, node)) return; const x = node.x; const y = node.y; const parent = getLayoutParent(node); const parentMatrix = parent ? worldTransforms.value.get(parent.id)?.matrix ?? localMatrix(parent) : { a: 1, b: 0, c: 0, d: 1 }; pointerDrag(event, (dx, dy) => { const localDelta = inverseTransformVector(parentMatrix, dx, -dy); node.x = roundLayout(x + localDelta.x); node.y = roundLayout(y + localDelta.y); rebaseNodeLayout(node); const world = worldTransforms.value.get(node.id); cursorPosition.value = { x: roundLayout(world?.x ?? node.x), y: roundLayout(world?.y ?? node.y) }; }); }
function startResize(event: PointerEvent, node: UINode, corner: ResizeCorner = "br") {
  if (event.button === 1) { startCanvasPan(event); return; }
  if (event.button !== 0 || node.locked) return;
  if (startAnimatedCanvasResize(event, node, corner)) return;
  const width = node.width;
  const height = node.height;
  const x = node.x;
  const y = node.y;
  const left = corner === "tl" || corner === "bl";
  const top = corner === "tl" || corner === "tr";
  const worldMatrix = worldTransforms.value.get(node.id)?.matrix ?? localMatrix(node);
  const ownMatrix = localMatrix(node);
  pointerDrag(event, (dx, dy) => {
    const localDelta = inverseTransformVector(worldMatrix, dx, -dy);
    const nextWidth = Math.max(20, roundLayout(width + (left ? -localDelta.x : localDelta.x)));
    const nextHeight = Math.max(20, roundLayout(height + (top ? localDelta.y : -localDelta.y)));
    const pivotShift = transformVector(ownMatrix, (nextWidth - width) * (node.pivotX - (left ? 1 : 0)), (nextHeight - height) * (node.pivotY - (top ? 0 : 1)));
    node.x = roundLayout(x + pivotShift.x);
    node.y = roundLayout(y + pivotShift.y);
    node.width = nextWidth;
    node.height = nextHeight;
    rebaseNodeLayout(node);
    applyDescendantLayouts(node.id);
  });
}
function formatDimension(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(2); }
function selectPreviewPreset(presetId: string) {
  const device = deviceModes.find((mode) => previewPresets[mode.id].some((preset) => preset.id === presetId));
  if (!device) return;
  deviceMode.value = device.id;
  previewPresetId.value = presetId;
  applyPreviewPreset();
}
function switchDevice(mode: DeviceMode) { deviceMode.value = mode; previewPresetId.value = previewPresets[mode][0].id; applyPreviewPreset(); }
function applyPreviewPreset() { const preset = currentPreset.value; canvasWidth.value = preset.width; canvasHeight.value = preset.height; getHierarchyOrder().forEach(applyNodeLayout); nextTick(fitCanvas); }
function fitCanvas() { const viewport = viewportElement.value; if (!viewport) return; const availableWidth = Math.max(200, viewport.clientWidth - 90); const availableHeight = Math.max(160, viewport.clientHeight - 80); zoom.value = Math.max(0.01, Math.min(1.5, availableWidth / canvasWidth.value, availableHeight / canvasHeight.value)); panX.value = 0; panY.value = 0; }
function formatTime(seconds: number) { const frames = Math.round((seconds % 1) * frameRate.value); return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`; }
function rewindPlayback() { eventPlaybackStarted = false; eventPreviewLog.value = []; playing.value = false; currentTime.value = 0; }
function togglePlayback() { if (!playing.value && currentTime.value >= sequenceDurationValue()) { currentTime.value = 0; eventPlaybackStarted = false; } lastTime = 0; playing.value = !playing.value; }
let timelineSpacePressed = false;
function isTimelineTextEditing(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const input = target.closest("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
  if (!input || input.readOnly || input.disabled) return false;
  return input.tagName === "TEXTAREA" || !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"].includes(input.type);
}
function handleTimelineKeyboardShortcut(event: KeyboardEvent) {
  if ((event.target as Element | null)?.closest?.('.ease-panel')) return;
  if ((event.target as Element | null)?.closest?.('.image-library')) return;
  if (timelineContextMenu.value || timelineDataImportOpen.value) return;
  const editor = editorElement.value;
  if (event.code !== "Space" || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !editor?.isConnected || editor.inert || !editor.getClientRects().length || isTimelineTextEditing(event.target)) return;
  // Capture Space before focused tree items/buttons can treat it as activation.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat || timelineSpacePressed) return;
  timelineSpacePressed = true;
  togglePlayback();
}
function handleTimelineClipClipboardShortcut(event: KeyboardEvent) {
  if ((event.target as Element | null)?.closest?.('.event-timeline')) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing || event.defaultPrevented) return;
  const key = event.key?.toLowerCase();
  const copy = key === "c" || event.code === "KeyC";
  const paste = key === "v" || event.code === "KeyV";
  if (!copy && !paste) return;
  const editor = editorElement.value;
  if (!editor?.isConnected || editor.inert || !editor.getClientRects().length || !hasOpenDocument.value
    || workspacePanelOpen.value || archiveAction.value || timelineContextMenu.value || tweenFieldPickerNodeId.value || timelineDataImportOpen.value) return;
  const target = event.target;
  // Read-only scrub fields still support selecting/copying text; leave their native shortcuts intact.
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role='textbox'], [role='dialog']"))) return;
  if (window.getSelection()?.toString()) return;
  if (copy ? !selectedTweenTrack.value || selectedId.value !== selectedTweenTrack.value.nodeId : !tweenClipClipboard.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat || draggingTweenTrackId.value || timelineScrubbing.value) return;
  if (copy) copySelectedTweenClip();
  else pasteTweenClipAtPlayhead();
}
function handleTimelineKeyboardRelease(event: KeyboardEvent) {
  if (event.code !== "Space" || !timelineSpacePressed) return;
  timelineSpacePressed = false;
  // Native buttons activate on keyup, so consume the matching release as well.
  event.preventDefault();
  event.stopImmediatePropagation();
}
function resetTimelineKeyboardShortcut() { timelineSpacePressed = false; }
function stepPlayback() { playing.value = false; currentTime.value = Math.min(sequenceDurationValue(), currentTime.value + 1 / frameRate.value); }
function setTimelineTimeFromClientX(clientX: number) {
  if (!timelineContent.value) return;
  const rect = timelineContent.value.getBoundingClientRect();
  if (rect.width <= 0) return;
  const rawTime = Math.max(0, Math.min(duration.value, (clientX - rect.left) / rect.width * duration.value));
  currentTime.value = Math.max(0, Math.min(duration.value, Math.round(rawTime * frameRate.value) / frameRate.value));
}
function nudgeTimelineProgress(frameDelta: number) { playing.value = false; currentTime.value = Math.max(0, Math.min(duration.value, currentTime.value + frameDelta / frameRate.value)); }
let stopTimelineScrub: (() => void) | null = null;
function startTimelineScrub(event: PointerEvent) {
  if (event.button !== 0 || !timelineContent.value) return;
  event.preventDefault();
  stopTimelineScrub?.();
  const pointerId = event.pointerId;
  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;
  playing.value = false;
  timelineScrubbing.value = true;
  document.body.style.cursor = "ew-resize";
  document.body.style.userSelect = "none";
  setTimelineTimeFromClientX(event.clientX);
  const move = (nextEvent: PointerEvent) => {
    if (nextEvent.pointerId !== pointerId) return;
    nextEvent.preventDefault();
    setTimelineTimeFromClientX(nextEvent.clientX);
  };
  const cleanup = (nextEvent?: PointerEvent) => {
    if (nextEvent && nextEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    timelineScrubbing.value = false;
    if (stopTimelineScrub === cleanup) stopTimelineScrub = null;
  };
  stopTimelineScrub = cleanup;
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}
function canCreateWorkspaceDocument() {
  if (!archive || archive.selectedWorkspace.value) return true;
  workspacePanelOpen.value = true;
  return false;
}
function toggleExportMenu() {
  const open = !exportMenuOpen.value;
  closeMenus();
  exportMenuOpen.value = open;
}
function onExportMenuFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) exportMenuOpen.value = false;
}
function toggleImportMenu() {
  const open = !importMenuOpen.value;
  closeMenus();
  importMenuOpen.value = open;
}
function onImportMenuFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) importMenuOpen.value = false;
}
function openGiaFile() { importMenuOpen.value = false; if (canCreateWorkspaceDocument()) giaFileInput.value?.click(); }
const psdFileInput = ref<HTMLInputElement | null>(null), psdImportBusy = ref(false), psdImportProgress = ref("正在解析 PSD…");
const spineFileInput = ref<HTMLInputElement | null>(null), spineImportBusy = ref(false);
function openSpineFolder() {
  importMenuOpen.value = false;
  if (!spineImportBusy.value && canCreateWorkspaceDocument()) spineFileInput.value?.click();
}
async function loadSpineFolder(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []); input.value = "";
  if (!files.length || spineImportBusy.value) return;
  spineImportBusy.value = true;
  const targetCanvas = { deviceMode: deviceMode.value, previewPresetId: previewPresetId.value, canvasWidth: canvasWidth.value, canvasHeight: canvasHeight.value };
  try {
    const { importSpineFiles } = await import("./spineImporter");
    const imported = await importSpineFiles(files, targetCanvas.canvasWidth, targetCanvas.canvasHeight);
    const status = `Spine · ${imported.nodes.length - 1} 个骨骼/附件 · ${imported.animations.length} 个动画${imported.warnings.length ? ` · ${imported.warnings.join('；')}` : ''}`;
    const serialized = JSON.stringify({
      version: 12, hierarchyLayoutVersion: 2, controlModelVersion: 2, timelineModelVersion: TIMELINE_MODEL_VERSION,
      name: imported.name, ...targetCanvas, nodes: imported.nodes,
      primitiveResources: imported.resources, animations: imported.animations, activeAnimationId: imported.animations[0].id,
      duration: imported.animations[0].duration, showContainerBones: true, giaImportStatus: status,
    });
    if (archive) await archive.createDocument(imported.name, async () => serialized);
    else applyProjectData(serialized);
    workspacePanelOpen.value = false;
    if (imported.warnings.length) toast.warning(`Spine 已导入，注意：${imported.warnings.join('；')}`);
    else toast.success("Spine 工程已导入。");
  } catch (error) {
    toast.error(`Spine 导入失败，当前工程未替换：${error instanceof Error ? error.message : '未知错误'}`);
  } finally { spineImportBusy.value = false; }
}
function openPsdFile() { importMenuOpen.value = false; if (!psdImportBusy.value && canCreateWorkspaceDocument()) psdFileInput.value?.click(); }
async function createPsdProject(file: File) {
  const mode = deviceMode.value;
  const presetId = previewPresetId.value;
  const width = canvasWidth.value;
  const height = canvasHeight.value;
  const { importPsdFile } = await import("./psdImporter");
  const imported = await importPsdFile(file, (done, total) => { psdImportProgress.value = `提取图层 ${done}/${total}`; });
  // 根容器适配当前画布，图层按中心锚点平移，保留 PSD 原始尺寸和相对布局。
  const root = imported.nodes.find(node => node.parentId === null);
  if (root) {
    root.x = width / 2; root.y = height / 2;
    root.width = width; root.height = height;
    for (const node of imported.nodes) {
      if (node.parentId !== root.id) continue;
      node.x += (width - imported.width) / 2;
      node.y += (height - imported.height) / 2;
    }
  }
  return JSON.stringify({
    version: 12, hierarchyLayoutVersion: 2, controlModelVersion: 2, timelineModelVersion: TIMELINE_MODEL_VERSION,
    name: file.name.replace(/\.psd$/i, ""), deviceMode: mode, previewPresetId: presetId, canvasWidth: width, canvasHeight: height,
    duration: 5, frameRate: 30, nodes: imported.nodes, primitiveResources: imported.resources, tweenTracks: [], showContainerBones: false,
    giaImportStatus: `PSD · ${imported.folders} 个文件夹 · ${imported.layers} 个图层 · ${imported.hidden} 个隐藏项${imported.warnings.length ? ` · ${imported.warnings.join("；")}` : ""}`,
  });
}
async function loadPsdFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
  if (!file || psdImportBusy.value) return;
  psdImportBusy.value = true; psdImportProgress.value = "正在解析 PSD…";
  try {
    if (archive) await archive.createDocument(file.name.replace(/\.psd$/i, ""), () => createPsdProject(file));
    else applyProjectData(await createPsdProject(file));
    workspacePanelOpen.value = false; primitiveResourceLibraryOpen.value = false;
    toast.success("PSD 已导入，图层图片可在图片资源面板中设置拟合。");
  } catch (error) {
    toast.error(`PSD 导入失败，当前文件已保留：${error instanceof Error ? error.message : "未知错误"}`);
  } finally { psdImportBusy.value = false; }
}
async function createGiaProject(file: File) {
  const mode = deviceMode.value;
  const presetId = previewPresetId.value;
  const width = canvasWidth.value;
  const height = canvasHeight.value;
  const deviceIndex: Record<DeviceMode, number> = { pc: 0, mobile: 1, controllerDesktop: 2, controllerMobile: 3 };
  const imported = importGiaControls(await file.arrayBuffer(), deviceIndex[mode]);
  const internalIdBySource = new Map(imported.controls.map((control) => [control.sourceNodeIndex, `gia_node_${control.sourceNodeIndex}`]));
  const importedNodes = imported.controls.map((control) => {
    const layout = control.layout;
    return makeNode(control.type, control.name, {
      id: internalIdBySource.get(control.sourceNodeIndex),
      parentId: control.parentSourceNodeIndex === null ? null : internalIdBySource.get(control.parentSourceNodeIndex) ?? null,
      active: layout.active, scaleX: layout.scaleX, scaleY: layout.scaleY, scaleZ: layout.scaleZ,
      rotationX: layout.rotationX, rotationY: layout.rotationY, rotation: layout.rotationZ,
      anchorMinX: layout.anchorMinX, anchorMinY: layout.anchorMinY, anchorMaxX: layout.anchorMaxX, anchorMaxY: layout.anchorMaxY,
      pivotX: layout.pivotX, pivotY: layout.pivotY, anchorOffsetX: layout.anchoredPositionX, anchorOffsetY: layout.anchoredPositionY,
      sizeDeltaX: layout.sizeDeltaX, sizeDeltaY: layout.sizeDeltaY, properties: control.properties as never,
    });
  });
  // 在独立数据上解析布局。文件尚未成功写入存档前不触碰当前编辑文件。
  const nodeMap = new Map(importedNodes.map((node) => [node.id, node]));
  const resolved = new Set<string>();
  const resolving = new Set<string>();
  const resolve = (node: UINode) => {
    if (resolved.has(node.id)) return;
    if (resolving.has(node.id)) throw new Error("GIA 控件层级存在循环");
    resolving.add(node.id);
    const parent = node.parentId ? nodeMap.get(node.parentId) : null;
    if (parent) resolve(parent);
    const parentWidth = parent?.width ?? width;
    const parentHeight = parent?.height ?? height;
    node.x = roundLayout(((1 - node.pivotX) * node.anchorMinX + node.pivotX * node.anchorMaxX) * parentWidth + node.anchorOffsetX);
    node.y = roundLayout(((1 - node.pivotY) * node.anchorMinY + node.pivotY * node.anchorMaxY) * parentHeight + node.anchorOffsetY);
    node.width = roundLayout(Math.max(1, (node.anchorMaxX - node.anchorMinX) * parentWidth + node.sizeDeltaX));
    node.height = roundLayout(Math.max(1, (node.anchorMaxY - node.anchorMinY) * parentHeight + node.sizeDeltaY));
    resolving.delete(node.id);
    resolved.add(node.id);
  };
  importedNodes.forEach(resolve);
  const counts = imported.controls.reduce<Record<string, number>>((result, control) => { result[control.type] = (result[control.type] ?? 0) + 1; return result; }, {});
  const typeSummary = Object.entries(counts).map(([type, count]) => `${controlLabels[type as ControlType]} ${count}`).join("、");
  const deviceLabel = deviceModes.find((device) => device.id === mode)?.label ?? mode;
  return JSON.stringify({
    version: 12, hierarchyLayoutVersion: 2, controlModelVersion: 2, timelineModelVersion: TIMELINE_MODEL_VERSION,
    name: imported.projectName || file.name.replace(/\.gia$/i, ""),
    deviceMode: mode, previewPresetId: presetId, canvasWidth: width, canvasHeight: height,
    duration: 5, frameRate: 30, nodes: importedNodes, tweenTracks: [],
    giaSource: { document: imported.sourceDocument, deviceIndex: deviceIndex[mode] },
    giaImportStatus: `GIA · ${imported.controls.length} 个控件 · ${deviceLabel}布局 · ${typeSummary}${imported.warnings.length ? ` · ${imported.warnings.join("；")}` : ""}`,
  });
}
async function loadGiaFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (archive) await archive.createDocument(file.name.replace(/\.gia$/i, ""), () => createGiaProject(file));
    else applyProjectData(await createGiaProject(file));
    workspacePanelOpen.value = false;
  } catch (error) {
    const message = `GIA 导入失败，当前文件已保留：${error instanceof Error ? error.message : "未知错误"}`;
    if (archive) { archive.error.value = message; workspacePanelOpen.value = true; }
    else window.alert(message);
  } finally { input.value = ""; }
}
function createBlankProject(name: string) {
  return JSON.stringify({
    version: 12, hierarchyLayoutVersion: 2, controlModelVersion: 2, timelineModelVersion: TIMELINE_MODEL_VERSION,
    name, deviceMode: "pc", previewPresetId: "pc-16-9", canvasWidth: DEFAULT_CANVAS_WIDTH, canvasHeight: DEFAULT_CANVAS_HEIGHT,
    duration: 5, frameRate: 30, nodes: [makeRootContainer()], tweenTracks: [],
  });
}
async function resetProject() {
  if (!archive) { applyProjectData(createBlankProject("Untitled UI Animation")); return; }
  if (!canCreateWorkspaceDocument()) return;
  requestArchiveAction("createDocument", "新建编辑文件", "在当前工作区创建独立的 UI 动画文件。", "新建动画");
}
function serializeProject() {
  return JSON.stringify({ version: 12, hierarchyLayoutVersion: 2, controlModelVersion: 2, timelineModelVersion: TIMELINE_MODEL_VERSION,
    name: projectName.value, deviceMode: deviceMode.value, previewPresetId: previewPresetId.value,
    canvasWidth: canvasWidth.value, canvasHeight: canvasHeight.value, duration: duration.value, frameRate: frameRate.value,
    nodes: nodes.value, controlTemplates: controlTemplates.value, primitiveResources: primitiveResources.value, giaSource: giaSource.value, tweenTracks: tweenTracks.value, keyframeTracks: keyframeTracks.value,
    animationModelVersion: 1, animations: animations.value, activeAnimationId: activeAnimationId.value,
    timelineSnapEnabled: timelineSnapEnabled.value, showContainerBones: showContainerBones.value, giaImportStatus: giaImportStatus.value }, null, 2);
}
async function saveProject() { if (archive) await runArchiveAction(() => archive.save()); else downloadProject(); }
function downloadProject() {
  exportMenuOpen.value = false;
  ensureSingleRootContainer();
  const url = URL.createObjectURL(new Blob([serializeProject()], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectName.value.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
function downloadLuaFile(code: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([code], { type: "text/x-lua;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exportTweenTimelineLib() {
  const result = buildTweenTimelineLibLua();
  downloadLuaFile(result.code, result.fileName);
  luaExportMenuOpen.value = false;
}
function exportPrimitiveImageLib() {
  const result = buildPrimitiveImageLibLua();
  downloadLuaFile(result.code, result.fileName);
  luaExportMenuOpen.value = false;
}
function exportSelectedPrimitiveProject() {
  try {
    const result = buildPrimitiveProjectLua({ projectName: projectName.value, rootNodeId: selectedNode.value?.id ?? "", nodes: nodes.value, resources: primitiveResources.value });
    downloadLuaFile(result.code, result.fileName);
    luaExportMenuOpen.value = false;
    toast.success(`已导出 ${result.targetCount} 个图元控件，共 ${result.elementCount} 张图片。`);
    if (result.warnings.length) toast.warning(`已跳过 ${result.warnings.length} 个未拟合控件，名称和原因已写入导出文件开头。`);
  } catch (error) { toast.error(`无法导出图元项目：${error instanceof Error ? error.message : String(error)}`); }
}
function openTimelineDataImport() {
  if (!hasOpenDocument.value || archive?.busy.value) return;
  stopDocumentInteraction();
  closeMenus();
  timelineDataRootId.value = selectedNode.value?.id ?? rootContainer.value?.id ?? "";
  timelineDataSource.value = "";
  timelineDataImportMode.value = "append";
  timelineDataImportOpen.value = true;
}
function confirmTimelineDataImport() {
  if (!timelineDataImportOpen.value || !hasOpenDocument.value || archive?.busy.value) return;
  const result = timelineDataImportPreview.value;
  if (!result || result.errors.length || !result.importedTracks.length && !result.importedEvents.length) return;
  const first = result.importedTracks[0];
  const mode = timelineDataImportMode.value;
  stopDocumentInteraction();
  keyframeTracks.value = result.tracks;
  activeAnimation.value.events = result.events;
  tweenTracks.value = [];
  duration.value = result.duration;
  currentTime.value = 0;
  selectedId.value = first?.nodeId ?? timelineDataRootId.value;
  selectedTweenTrackId.value = null;
  selectedKeyframeId.value = first?.keyframes[0]?.id ?? null;
  timelineDataSource.value = "";
  timelineEditNotice.value = "已还原 " + result.importedTracks.length + " 条关键帧轨道、" + result.importedEvents.length + " 个事件" + (mode === "replace" ? "，替换了所选范围内的 " + result.replacedCount + " 条轨道。" : "，已追加到当前时间轴。");
}
function exportSelectedNodeTweenData() {
  try { exportSelectedNodeKeyframeData(); }
  catch (error) { toast.error(`无法导出关键帧：${error instanceof Error ? error.message : String(error)}`); }
}
function exportSelectedNodeKeyframeData() {
  const rootNode = selectedNode.value;
  if (!rootNode) {
    window.alert("请先在层级、画布或时间轴中选择导出根控件。");
    return;
  }
  const result = buildKeyframeTimelineDataLua({
    projectName: `${projectName.value}_${activeAnimation.value.name}`,
    rootNodeId: rootNode.id,
    nodes: nodes.value,
    tracks: keyframeTracks.value,
    events: activeAnimation.value.events,
    sequenceDuration: duration.value,
  });
  if (!result.trackCount && !result.eventCount) {
    const detail = result.warnings.length ? `\n\n${result.warnings.join("\n")}` : "";
    window.alert(`控件「${rootNode.name}」及其子级目前没有可导出的 Tween。${detail}`);
    return;
  }
  downloadLuaFile(result.code, result.fileName);
  luaExportMenuOpen.value = false;
  if (result.warnings.length) {
    window.alert(`Timeline Data 已导出，并附带 ${result.warnings.length} 条提示。`);
  }
}
type SavedNode = Partial<ClientUIBaseControlModel> & { type?: ControlType; editor?: UINodeEditorSettings | null; properties?: Record<string, unknown>; colorRGBA?: ColorRGBA; color?: string; opacity?: number; text?: string; imageId?: number | null; imageType?: string; fontSize?: number; fontColor?: ColorRGBA; bgColor?: ColorRGBA; enableOutline?: boolean; outlineColor?: ColorRGBA; horizontalAlignment?: string; verticalAlignment?: string; adaptiveFontSize?: boolean; minimumFontSize?: number };
const baseControlKeys: Array<keyof ClientUIBaseControlModel> = ["id", "parentId", "name", "active", "x", "y", "width", "height", "scaleX", "scaleY", "scaleZ", "rotationX", "rotationY", "rotation", "anchorMinX", "anchorMinY", "anchorMaxX", "anchorMaxY", "pivotX", "pivotY", "anchorOffsetX", "anchorOffsetY", "sizeDeltaX", "sizeDeltaY", "canControllerFocus", "visible", "locked"];
function pickBaseControl(value: SavedNode) { const result: Partial<ClientUIBaseControlModel> = {}; const target = result as Record<string, unknown>; const source = value as Record<string, unknown>; baseControlKeys.forEach((key) => { if (source[key] !== undefined) target[key] = source[key]; }); return result; }
function hasSavedLayoutState(value: Partial<ClientUIBaseControlModel>) { return Number.isFinite(value.anchorOffsetX) && Number.isFinite(value.anchorOffsetY) && Number.isFinite(value.sizeDeltaX) && Number.isFinite(value.sizeDeltaY); }
function normalizeNode(value: SavedNode): UINode { const hasLayoutState = hasSavedLayoutState(value); const type = value.type && Object.prototype.hasOwnProperty.call(controlRegistry, value.type) ? value.type : "container"; const savedProperties = value.properties ?? {}; const properties = { ...createControlProperties(type), ...savedProperties } as Record<string, unknown>; const hasSavedProperty = (key: string) => Object.prototype.hasOwnProperty.call(savedProperties, key); const assignLegacy = (key: string, legacyValue: unknown) => { if (!hasSavedProperty(key) && legacyValue !== undefined) properties[key] = legacyValue; };
  if (type === "image") { assignLegacy("imageId", value.imageId); assignLegacy("imageColor", value.colorRGBA ?? (value.color ? colorFromHex(value.color, Number.isFinite(value.opacity) ? Number(value.opacity) : 1) : undefined)); assignLegacy("imageType", value.imageType === "default" ? "basic" : value.imageType); if (properties.imageType === "default") properties.imageType = "basic"; }
  if (type === "text" || type === "textWindow") { assignLegacy("text", value.text); assignLegacy("fontSize", value.fontSize); assignLegacy("fontColor", value.fontColor ?? value.colorRGBA); assignLegacy("bgColor", value.bgColor); assignLegacy("enableOutline", value.enableOutline); assignLegacy("outlineColor", value.outlineColor); assignLegacy("horizontalAlignment", value.horizontalAlignment); assignLegacy("verticalAlignment", value.verticalAlignment); assignLegacy("adaptiveFontSize", value.adaptiveFontSize); assignLegacy("minimumFontSize", value.minimumFontSize); }
  const baseOverrides = { ...pickBaseControl(value), active: typeof value.active === "boolean" ? value.active : true, anchorMinX: Number.isFinite(value.anchorMinX) ? Number(value.anchorMinX) : 0.5, anchorMinY: Number.isFinite(value.anchorMinY) ? Number(value.anchorMinY) : 0.5, anchorMaxX: Number.isFinite(value.anchorMaxX) ? Number(value.anchorMaxX) : 0.5, anchorMaxY: Number.isFinite(value.anchorMaxY) ? Number(value.anchorMaxY) : 0.5, pivotX: Number.isFinite(value.pivotX) ? Number(value.pivotX) : 0.5, pivotY: Number.isFinite(value.pivotY) ? Number(value.pivotY) : 0.5 }; const name = value.name === undefined ? getControlDefinition(type).defaultName : String(value.name); const node = makeNode(type, name, { ...baseOverrides, editor: value.editor, properties: properties as never });
  if (!hasLayoutState) { node.x = canvasWidth.value / 2 + (Number(value.x) || 0); node.y = canvasHeight.value / 2 - (Number(value.y) || 0); } return node; }
function normalizeTweenTracks(value: unknown, timelineModelVersion = 0) {
  if (!Array.isArray(value)) return [] as UITweenTrack[];
  const nodeById = new Map(nodes.value.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const result: UITweenTrack[] = [];
  const sequenceDuration = sequenceDurationValue();
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const saved = item as Record<string, unknown>;
    const nodeId = typeof saved.nodeId === "string" ? saved.nodeId : "";
    const fieldKey = typeof saved.fieldKey === "string" ? saved.fieldKey : "";
    const node = nodeById.get(nodeId);
    const field = node ? getTweenableField(node.type, fieldKey) : null;
    if (!node || !field) return;
    const relative = saved.relative === true && isRelativeTweenField(fieldKey);
    const fallbackValue = relative ? 0 : readTweenFieldValue(node, field);
    const loadValue = (slot: "initialValue" | "endValue") => {
      if (!Object.prototype.hasOwnProperty.call(saved, slot)) return cloneTweenValue(fallbackValue);
      // 无效数值回退到当前原值时，该值已经是锚点偏移，不能再按旧版本转换。
      if (field.valueKind === "number" && saved[slot] !== null &&
          (typeof saved[slot] !== "number" || !Number.isFinite(saved[slot]))) {
        return cloneTweenValue(fallbackValue);
      }
      const normalized = normalizeTweenValue(saved[slot], field, fallbackValue);
      if (!relative && timelineModelVersion === 6) return convertParentCenteredTweenValueToRuntime(node, field, normalized);
      if (!relative && timelineModelVersion === 4) return convertAbsoluteTweenEditorValueToRuntime(node, field, normalized);
      // v7 及以后、v5 和更早的锚点偏移版本均保留原值；重新保存后不会重复迁移。
      return normalized;
    };
    const clipDuration = Number(Math.min(sequenceDuration, Math.max(MIN_TWEEN_DURATION, typeof saved.duration === "number" && Number.isFinite(saved.duration) && saved.duration > 0 ? saved.duration : Math.min(DEFAULT_TWEEN_DURATION, sequenceDuration))).toFixed(6));
    const startTime = Number(Math.min(sequenceDuration - clipDuration, typeof saved.startTime === "number" && Number.isFinite(saved.startTime) ? Math.max(0, saved.startTime) : 0).toFixed(6));
    const easeType: TweenEaseType = isTweenEaseType(saved.easeType) ? saved.easeType : "Linear";
    let id = typeof saved.id === "string" && saved.id ? saved.id : createTweenId();
    while (seen.has(id)) id = createTweenId();
    seen.add(id);
    const track: UITweenTrack = {
      id,
      nodeId, fieldKey, startTime, duration: clipDuration,
      initialValue: loadValue("initialValue"), endValue: loadValue("endValue"), easeType,
      ...(relative ? { relative: true } : {}),
    };
    if (result.some((other) => tweenClipsOverlap(track, other))) throw new Error(`「${node.name}」的 ${fieldKey} 存在重叠 Clip，请先调整时间后再导入。`);
    result.push(track);
  });
  return result;
}
function migrateLegacyHierarchyLayout() { const legacyWorldPositions = new Map(nodes.value.map((node) => [node.id, { x: node.x, y: node.y }])); const migratedWorldTransforms = new Map<string, WorldTransform>(); getHierarchyOrder().forEach((node) => { const legacyWorld = legacyWorldPositions.get(node.id) ?? { x: node.x, y: node.y }; const local = localMatrix(node); const parent = getLayoutParent(node); const parentWorld = parent ? migratedWorldTransforms.get(parent.id) : null; if (!parent || !parentWorld) { node.x = legacyWorld.x; node.y = legacyWorld.y; migratedWorldTransforms.set(node.id, { x: node.x, y: node.y, matrix: local }); return; } const localOffset = inverseTransformVector(parentWorld.matrix, legacyWorld.x - parentWorld.x, legacyWorld.y - parentWorld.y); node.x = roundLayout(parent.pivotX * parent.width + localOffset.x); node.y = roundLayout(parent.pivotY * parent.height + localOffset.y); migratedWorldTransforms.set(node.id, { x: legacyWorld.x, y: legacyWorld.y, matrix: multiplyMatrix(parentWorld.matrix, local) }); }); }
function openProject() { importMenuOpen.value = false; if (canCreateWorkspaceDocument()) fileInput.value?.click(); }
function applyProjectData(serialized: string, resetHistory = true) {
  historyApplyingProject = true;
  try {
    applyProjectDataContents(serialized);
    stopCanvasNodeDrag?.();
    boneCreateMode.value = false;
    boneParentId.value = null;
    if (!archive && resetHistory) editorHistory.reset(captureUndoState());
  } finally { historyApplyingProject = false; }
}
function applyProjectDataContents(serialized: string) {
  const data = JSON.parse(serialized);
  if (!data || !Array.isArray(data.nodes) || data.nodes.some((node: unknown) => !node || typeof node !== "object" || Array.isArray(node))) {
    throw new Error("这不是有效的 UI 动画工程文件");
  }
  const loadedTemplates = normalizeControlTemplates(data.controlTemplates);
  const removedScaleTracks = removeRetiredScaleTweenTracks(data);
  const loadedPrimitiveResources = normalizePrimitiveResources(data.primitiveResources);
  const loadedGiaSource = normalizeGiaExportSource(data.giaSource);
  giaExportOpen.value = false;
  templateLibraryOpen.value = false;
  controlTemplates.value = loadedTemplates;
  primitiveResourceLibraryOpen.value = false;
  projectName.value = String(data.name || "Untitled UI Animation");
  canvasWidth.value = Math.max(1, Number(data.canvasWidth) || 1600);
  canvasHeight.value = Math.max(1, Number(data.canvasHeight) || 900);
  const savedMode = deviceModes.some((device) => device.id === data.deviceMode) ? data.deviceMode as DeviceMode
    : deviceModes.find((device) => previewPresets[device.id].some((preset) => preset.width === canvasWidth.value && preset.height === canvasHeight.value))?.id ?? "pc";
  deviceMode.value = savedMode;
  const savedPreset = previewPresets[savedMode].find((preset) => preset.id === data.previewPresetId || (preset.width === canvasWidth.value && preset.height === canvasHeight.value));
  previewPresetId.value = savedPreset?.id ?? previewPresets[savedMode][0].id;
  duration.value = Math.max(0.5, Number(data.duration) || 5);
  timelineSnapEnabled.value = data.timelineSnapEnabled !== false;
  showContainerBones.value = data.showContainerBones !== false;
  timelineSnapTime.value = null;
  timelineEditNotice.value = "";
  frameRate.value = Number.isFinite(Number(data.frameRate)) && Number(data.frameRate) > 0 ? Math.max(1, Math.min(240, Math.round(Number(data.frameRate)))) : 30;
  nodes.value = data.nodes.map((node: SavedNode) => normalizeNode(node));
  const migratedImages = migratePrimitiveResources(nodes.value, loadedPrimitiveResources);
  nodes.value = migratedImages.nodes;
  primitiveResources.value = migratedImages.resources;
  if (data.hierarchyLayoutVersion !== 2) migrateLegacyHierarchyLayout();
  getHierarchyOrder().forEach(rebaseNodeLayout);
  ensureSingleRootContainer();
  if (loadedGiaSource && !loadedGiaSource.baseline) loadedGiaSource.baseline = JSON.parse(JSON.stringify(nodes.value));
  giaSource.value = loadedGiaSource;
  tweenTracks.value = data.animations !== undefined ? [] : normalizeTweenTracks(data.tweenTracks, Number(data.timelineModelVersion) || 0);
  const loadedAnimations = data.animations !== undefined
    ? normalizeAnimationCollection(data.animations, nodes.value)
    : [{ id: "animation-default", name: "默认动画", duration: duration.value, keyframeTracks: data.keyframeTracks !== undefined
      ? normalizeKeyframeTracks(data.keyframeTracks, nodes.value) : migrateTweenClipsToKeyframes(tweenTracks.value) }];
  animations.value = loadedAnimations;
  activeAnimationId.value = loadedAnimations.some(animation => animation.id === data.activeAnimationId) ? data.activeAnimationId : loadedAnimations[0].id;
  animationNotice.value = "";
  tweenTracks.value = [];
  selectedKeyframeId.value = null;
  keyframeDocumentEpoch.value += 1;
  duration.value = Math.max(duration.value, ...keyframeTracks.value.flatMap(track => track.keyframes.map(key => key.time)));
  tweenClipClipboard.value = null;
  timelineDataImportOpen.value = false;
  selectedTweenTrackId.value = null;
  closeTweenFieldPicker();
  giaImportStatus.value = typeof data.giaImportStatus === "string" ? data.giaImportStatus : "";
  playing.value = false;
  currentTime.value = 0;
  selectedId.value = rootContainer.value?.id ?? null;
  search.value = "";
  collapsed.value = new Set();
  if (removedScaleTracks) {
    timelineEditNotice.value = `已移除 ${removedScaleTracks} 条游戏内无效的 localScaleX / localScaleY 动画轨道，静态缩放保持不变。`;
    toast.warning(timelineEditNotice.value);
  }
  nextTick(fitCanvas);
}
async function loadProject(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (archive) await archive.createDocument(file.name.replace(/\.json$/i, ""), () => file.text());
    else {
      const previous = serializeProject();
      try { applyProjectData(await file.text(), false); editorHistory.reset(captureUndoState()); }
      catch (error) { applyProjectData(previous, false); throw error; }
    }
    workspacePanelOpen.value = false;
  } catch (error) {
    const message = `无法导入，当前文件已保留：${error instanceof Error ? error.message : "未知错误"}`;
    if (archive) { archive.error.value = message; workspacePanelOpen.value = true; }
    else window.alert(message);
  } finally { input.value = ""; }
}
function stopDocumentInteraction() {
  eventPreviewLog.value = []; eventPlaybackStarted = false;
  giaExportOpen.value = false;
  templateLibraryOpen.value = false;
  stopCanvasNodeDrag?.();
  editorHistory.flush();
  historyPanelOpen.value = false;
  playing.value = false;
  timelineDataImportOpen.value = false;
  tweenClipClipboard.value = null;
  lastTime = 0;
  resetTimelineKeyboardShortcut();
  cancelHierarchyPress?.();
  stopTweenClipDrag?.();
  stopTimelineResize?.();
  stopTimelineScrub?.();
  closeTweenFieldPicker();
  luaExportMenuOpen.value = false;
}
async function runArchiveAction(action: () => Promise<unknown>) {
  try { await action(); return true; }
  catch (error) {
    workspacePanelOpen.value = true;
    if (archive) archive.error.value = error instanceof Error ? error.message : "存档操作失败";
    return false;
  }
}
async function openWorkspaceDocument(name: string) {
  if (!archive) return;
  await runArchiveAction(async () => { await archive.switchDocument(name); workspacePanelOpen.value = false; });
}
function requestArchiveAction(kind: ArchiveActionKind, title: string, message: string, initialValue = "") {
  if (!archive || archive.busy.value) return;
  archive.error.value = "";
  archiveAction.value = { kind, title, message, initialValue, mode: kind.startsWith("delete") ? "confirm" : "name" };
}
function createWorkspace() {
  requestArchiveAction("createWorkspace", "新建工作区", "工作区用于集中保存多个独立的编辑文件。", "新工作区");
}
function renameWorkspace() {
  if (!archive?.selectedWorkspace.value) return;
  requestArchiveAction("renameWorkspace", "重命名工作区", "编辑文件会保留在此工作区内。", archive.selectedWorkspace.value);
}
function deleteWorkspace() {
  if (!archive?.selectedWorkspace.value) return;
  requestArchiveAction("deleteWorkspace", "删除工作区", `将「${archive.selectedWorkspace.value}」及其编辑文件移至回收站？当前页面可撤销最近一次删除。`);
}
function renameWorkspaceDocument() {
  if (!archive?.selectedDocument.value) return;
  requestArchiveAction("renameDocument", "重命名编辑文件", "控件、参数和 Timeline 不会改变。", archive.selectedDocument.value);
}
function deleteWorkspaceDocument() {
  if (!archive?.selectedDocument.value) return;
  requestArchiveAction("deleteDocument", "删除编辑文件", `将「${archive.selectedDocument.value}」移至回收站？当前页面可撤销最近一次删除。`);
}
async function confirmArchiveAction(value: string) {
  if (!archive || archive.busy.value || !archiveAction.value) return;
  const { kind } = archiveAction.value;
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
    if (kind === "createDocument" || kind.startsWith("delete")) workspacePanelOpen.value = false;
  }
}
async function retryArchive() {
  if (archive) await runArchiveAction(() => archive.ready.value ? archive.save() : archive.initialize());
}
function handleArchiveBeforeUnload(event: BeforeUnloadEvent) {
  // Deferred gesture snapshots must be visible to the unsaved-changes guard.
  if (editorHistory.interacting.value) {
    finishEditorHistoryInteraction();
    archive?.queueSave(serializeProject());
  }
  if (archive?.dirty.value || archive?.busy.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
let editorResizeObserver: ResizeObserver | null = null;
let historyApplyingProject = false;
let historyPointerId: number | null = null;
let historyInputTarget: HTMLElement | null = null;
let historyDocumentKey: string | null = null;
function captureUndoState() {
  return JSON.stringify({ nodes: nodes.value, controlTemplates: controlTemplates.value, primitiveResources: primitiveResources.value, giaSource: giaSource.value, tweenTracks: tweenTracks.value, animations: animations.value,
    frameRate: frameRate.value, deviceMode: deviceMode.value,
    previewPresetId: previewPresetId.value, canvasWidth: canvasWidth.value, canvasHeight: canvasHeight.value,
    timelineSnapEnabled: timelineSnapEnabled.value, showContainerBones: showContainerBones.value,
    giaImportStatus: giaImportStatus.value });
}
function restoreUndoState(snapshot: string) {
  const data = JSON.parse(snapshot);
  // History owns exact editor snapshots: don't rebase anchors or run import migrations.
  playing.value = false;
  lastTime = 0;
  stopCanvasNodeDrag?.();
  cancelHierarchyPress?.();
  stopTweenClipDrag?.();
  stopTimelineScrub?.();
  closeTweenFieldPicker();
  closeTimelineContextMenu();
  nodes.value = data.nodes;
  controlTemplates.value = data.controlTemplates ?? [];
  primitiveResources.value = data.primitiveResources ?? [];
  primitiveResourceLibraryOpen.value = false;
  giaSource.value = data.giaSource ?? null;
  templateLibraryOpen.value = false;
  tweenTracks.value = data.tweenTracks;
  animations.value = data.animations ?? [{ id: "animation-default", name: "默认动画", duration: data.duration ?? 5, keyframeTracks: data.keyframeTracks ?? [] }];
  if (!animations.value.some(animation => animation.id === activeAnimationId.value)) activeAnimationId.value = animations.value[0].id;
  keyframeDocumentEpoch.value += 1;
  if (!keyframeTracks.value.some(track => track.keyframes.some(key => key.id === selectedKeyframeId.value))) selectedKeyframeId.value = null;
  frameRate.value = data.frameRate;
  deviceMode.value = data.deviceMode;
  previewPresetId.value = data.previewPresetId;
  canvasWidth.value = data.canvasWidth;
  canvasHeight.value = data.canvasHeight;
  timelineSnapEnabled.value = data.timelineSnapEnabled;
  showContainerBones.value = data.showContainerBones;
  giaImportStatus.value = data.giaImportStatus;
  currentTime.value = Math.min(currentTime.value, duration.value);
  if (!nodes.value.some((node) => node.id === selectedId.value)) selectedId.value = rootContainer.value?.id ?? null;
  if (!tweenTracks.value.some((track) => track.id === selectedTweenTrackId.value && track.nodeId === selectedId.value)) selectedTweenTrackId.value = null;
  timelineSnapTime.value = null;
  timelineEditNotice.value = "";
  archive?.queueSave(serializeProject());
}
const editorHistory = createEditorHistory({ capture: captureUndoState, restore: restoreUndoState, describe: describeHistoryChange, limit: 100 });
watch(selectedId, (nodeId) => {
  imageLibraryOpen.value = false;
  templateLibraryOpen.value = false;
  if (!keyframeTracks.value.some(track => track.nodeId === nodeId && track.keyframes.some(key => key.id === selectedKeyframeId.value))) selectedKeyframeId.value = null;
}, { flush: "sync" });
watch(imageLibraryOpen, open => { if (open) templateLibraryOpen.value = false; });
function handleEditorHistoryChange(snapshot: string | null) {
  if (snapshot === null || historyApplyingProject || !hasOpenDocument.value || archive && (!archive.ready.value || archive.busy.value || archive.loading.value)) return;
  editorHistory.observe(snapshot);
}
function syncEditorHistoryDocument() {
  if (!archive || !archive.ready.value || archive.busy.value || archive.loading.value) return;
  const key = JSON.stringify([archive.selectedWorkspace.value, archive.selectedDocument.value]);
  if (key === historyDocumentKey) return;
  historyDocumentKey = key;
  historyPointerId = null;
  historyInputTarget = null;
  historyPanelOpen.value = false;
  editorHistory.reset(captureUndoState());
}
function historyInteractionAllowed() {
  return hasOpenDocument.value && !editorHistory.busy.value && !archive?.busy.value && !workspacePanelOpen.value && !archiveAction.value && !timelineDataImportOpen.value;
}
function beginEditorHistoryPointer(event: PointerEvent) {
  if (event.button !== 0 || !historyInteractionAllowed()) return;
  if ((event.target as Element | null)?.closest?.(".history-tools")) return;
  if (historyInputTarget && event.target !== historyInputTarget) {
    historyInputTarget = null;
    editorHistory.end("input");
  }
  historyPointerId = event.pointerId;
  editorHistory.begin("pointer");
}
function endEditorHistoryPointer(event?: PointerEvent) {
  if (event && historyPointerId !== event.pointerId) return;
  const pointerId = historyPointerId;
  // Other pointerup handlers commit hierarchy drops and numeric drags first.
  queueMicrotask(() => {
    if (historyPointerId !== pointerId) return;
    historyPointerId = null;
    editorHistory.end("pointer");
  });
}
function beginEditorHistoryInput(event: Event) {
  if (!historyInteractionAllowed() || !(event.target instanceof HTMLElement)) return;
  const target = event.target;
  if (!target.matches("input, textarea") && !target.isContentEditable) return;
  if (target.matches("input[readonly], textarea[readonly]")) return;
  if (target.matches("input[type='checkbox'], input[type='radio'], input[type='file'], input[type='button']")) return;
  if (historyInputTarget && historyInputTarget !== target) editorHistory.end("input");
  historyInputTarget = target;
  editorHistory.begin("input");
}
function endEditorHistoryInput(event: FocusEvent) {
  if (event.target !== historyInputTarget) return;
  const target = historyInputTarget;
  queueMicrotask(() => {
    if (historyInputTarget !== target) return;
    historyInputTarget = null;
    editorHistory.end("input");
  });
}
function finishEditorHistoryInteraction() {
  historyPointerId = null;
  historyInputTarget = null;
  editorHistory.end("pointer");
  editorHistory.end("input");
  editorHistory.end("keyframe");
  editorHistory.flush();
}
async function undoEditorOperation() {
  if (!historyInteractionAllowed() || historyPointerId !== null) return;
  finishEditorHistoryInteraction();
  const previousIndex = editorHistory.index.value;
  const entry = editorHistory.entries.value[previousIndex];
  if (!entry) return;
  try {
    await editorHistory.undo();
    if (editorHistory.index.value === previousIndex - 1 && editorHistory.entries.value[previousIndex]?.id === entry.id) {
      toast.info(`撤回:【${entry.label}】还可撤回${editorHistory.index.value + 1}步`);
    }
  }
  catch (error) { timelineEditNotice.value = `撤销失败：${error instanceof Error ? error.message : String(error)}`; }
}
async function redoEditorOperation() {
  if (!historyInteractionAllowed() || historyPointerId !== null) return;
  finishEditorHistoryInteraction();
  const nextIndex = editorHistory.index.value + 1;
  const entry = editorHistory.entries.value[nextIndex];
  if (!entry) return;
  try {
    await editorHistory.redo();
    if (editorHistory.index.value === nextIndex && editorHistory.entries.value[nextIndex]?.id === entry.id) {
      toast.info(`重做【${entry.label}】还可重做${editorHistory.entries.value.length - editorHistory.index.value - 1}步`);
    }
  }
  catch (error) { timelineEditNotice.value = `重做失败：${error instanceof Error ? error.message : String(error)}`; }
}
function handleEditorHistoryKeyboard(event: KeyboardEvent) {
  if ((event.target as Element | null)?.closest?.('.ease-panel')) return;
  const key = event.key?.toLowerCase();
  const undo = key === "z" && !event.shiftKey;
  const redo = key === "y" || key === "z" && event.shiftKey;
  const editor = editorElement.value;
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || event.defaultPrevented || !undo && !redo
    || !editor?.isConnected || editor.inert || !editor.getClientRects().length || !historyInteractionAllowed()
    || timelineContextMenu.value || tweenFieldPickerNodeId.value || isTimelineTextEditing(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat || historyPointerId !== null) return;
  if (undo) void undoEditorOperation(); else void redoEditorOperation();
}
function syncEditorHeight() { editorHeight.value = editorElement.value?.clientHeight ?? 0; if (timelineHeight.value !== null) timelineHeight.value = clampTimelineHeight(timelineHeight.value); }
let frame = 0; let lastTime = 0; function animate(now: number) { if (playing.value) { if (!lastTime) lastTime = now; advanceTimelinePlayback((now - lastTime) / 1000); } lastTime = now; frame = requestAnimationFrame(animate); } frame = requestAnimationFrame(animate); onMounted(() => { getHierarchyOrder().forEach(rebaseNodeLayout); ensureSingleRootContainer(); syncEditorHeight(); fitCanvas(); editorResizeObserver = new ResizeObserver(syncEditorHeight); if (editorElement.value) editorResizeObserver.observe(editorElement.value); window.addEventListener("resize", fitCanvas); window.addEventListener("keydown", handleTimelineKeyboardShortcut, true); window.addEventListener("keydown", handleTimelineClipClipboardShortcut, true); window.addEventListener("keyup", handleTimelineKeyboardRelease, true); window.addEventListener("blur", resetTimelineKeyboardShortcut); }); onBeforeUnmount(() => { cancelHierarchyPress?.(); stopTweenClipDrag?.(); stopTimelineResize?.(); stopTimelineScrub?.(); editorResizeObserver?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", fitCanvas); window.removeEventListener("keydown", handleTimelineKeyboardShortcut, true); window.removeEventListener("keydown", handleTimelineClipClipboardShortcut, true); window.removeEventListener("keyup", handleTimelineKeyboardRelease, true); window.removeEventListener("blur", resetTimelineKeyboardShortcut); resetTimelineKeyboardShortcut(); });
// 持久化源数据，不监听播放进度或 previewNodes，避免把动画中间值写回基础参数。
// Stop before serialization, rather than debouncing only the subsequent disk write.
// The history controller captures the final state when the last gesture ends.
function observeProjectSnapshot() { return editorHistory.interacting.value || editorHistory.busy.value ? null : serializeProject(); }
function observeUndoSnapshot() { return editorHistory.interacting.value || editorHistory.busy.value ? null : captureUndoState(); }
watch(observeProjectSnapshot, (snapshot) => { if (snapshot !== null) archive?.queueSave(snapshot); }, { flush: "post" });
watch(observeUndoSnapshot, handleEditorHistoryChange, { flush: "post" });
watch(() => [archive?.ready.value, archive?.busy.value, archive?.loading.value, archive?.selectedWorkspace.value, archive?.selectedDocument.value], syncEditorHistoryDocument, { flush: "sync" });
onMounted(() => {
  void loadImageCatalog();
  editorHistory.reset(captureUndoState());
  window.addEventListener("keydown", handleEditorHistoryKeyboard, true);
  window.addEventListener("pointerup", endEditorHistoryPointer);
  window.addEventListener("pointercancel", endEditorHistoryPointer);
  window.addEventListener("blur", finishEditorHistoryInteraction);
  if (archive) void runArchiveAction(() => archive.initialize());
  window.addEventListener("beforeunload", handleArchiveBeforeUnload);
});
onBeforeRouteLeave(async () => {
  if (!archive) return true;
  try { await archive.prepareToLeave(); return true; }
  catch { workspacePanelOpen.value = true; return false; }
});
onBeforeUnmount(() => {
  stopCanvasNodeDrag?.();
  finishEditorHistoryInteraction();
  editorHistory.dispose();
  window.removeEventListener("keydown", handleEditorHistoryKeyboard, true);
  window.removeEventListener("pointerup", endEditorHistoryPointer);
  window.removeEventListener("pointercancel", endEditorHistoryPointer);
  window.removeEventListener("blur", finishEditorHistoryInteraction);
  window.removeEventListener("beforeunload", handleArchiveBeforeUnload);
  // 路由守卫负责正常离开；卸载兜底仍提交已捕获的快照。
  void archive?.dispose().catch((error) => console.error("UI 动画存档保存失败", error));
});
</script>

<style scoped>
.primitive-display-mode { display: flex; gap: 5px; margin-top: 7px; }
.primitive-display-mode button { padding: 5px 7px; border: 1px solid #596780; border-radius: 5px; background: #343e51; color: #dce6f9; font-size: 11px; cursor: pointer; }
.primitive-display-mode button[aria-pressed=true] { background: #675084; border-color: #b590dd; }
.primitive-display-mode button:disabled { opacity: .5; cursor: default; }
.template-reference-picker { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 8px; border: 1px solid #536383; border-radius: 5px; color: #dfe7f7; background: #262b35; text-align: left; font-size: 11px; cursor: pointer; overflow-wrap: anywhere; }
.template-reference-picker span { flex: none; color: #a6bcff; }
.template-original-size { margin-top: 6px; padding: 3px 0; border: 0; background: transparent; color: #a6bcff; font-size: 10px; cursor: pointer; }
.keyframe-panel { display: flex !important; flex-direction: column; min-height: 0; }
.keyframe-notice { position: absolute; right: 260px; top: -29px; max-width: 560px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 8px; margin: 0; border-radius: 4px; color: #e4c1c6; background: #392b33; pointer-events: none; z-index: 10; }
.animation-editor {
  position: relative;
  --bg: #303540;
  --input: #262b35;
  --hierarchy-width: 252px;
  --inspector-width: 306px;
  --panel: #303540;
  --line: #454b58;
  --muted: #a9afbb;
  --text: #e4e7ef;
  --accent: #527cf3;
  height: 100%;
  min-width: 980px;
  display: grid;
  grid-template-rows: 48px minmax(260px, 1fr) var(--timeline-height, 250px);
  grid-template-columns: minmax(0, 1fr);
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  text-align: left;
  border-radius: 0;
  font-family: "StarRailFont", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  color-scheme: dark;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  background: #2c313c;
  border-bottom: 1px solid var(--line);
}

.archive-status {
  border: 0;
  background: transparent;
  color: #95c9b3;
  font: inherit;
  font-size: 10px;
  max-width: 106px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  flex-shrink: 0;
}
.archive-status.has-error { color: #efad8c; }
.document-empty-state {
  position: absolute;
  inset: 48px 0 0;
  z-index: 12;
  background: #282e39;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
}
.document-empty-state h2 { color: #e0e8f5; font-size: 18px; margin: 0; }
.document-empty-state p { color: #9eaec3; max-width: 560px; line-height: 1.8; }
.document-empty-state button, .archive-undo {
  border: 1px solid #527cf3;
  border-radius: 7px;
  background: #354e87;
  color: #e2ebff;
  padding: 9px 15px;
  cursor: pointer;
  font: inherit;
}
.archive-undo { position: absolute; z-index: 15; bottom: 16px; left: 50%; transform: translateX(-50%); box-shadow: 0 4px 20px #0007; }

.brand-mark {
  width: 30px;
  height: 30px;
  border: 1px solid #758197;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 800;
  color: #d6dbe5;
}

.project-copy {
  display: flex;
  flex-direction: column;
  min-width: 150px;
}

.project-copy strong { font-size: 13px; }
.project-copy span,
.eyebrow { color: #758196; font-size: 10px; letter-spacing: .13em; }
.toolbar-divider { width: 1px; height: 24px; background: var(--line); }
button, select, input, textarea { font: inherit; }
/* Native form and code elements also inherit the app's custom font. */
:deep(button), :deep(input), :deep(select), :deep(textarea),
:deep(code), :deep(kbd), :deep(pre), :deep(samp) { font-family: inherit; }

.tool-button,
.icon-button,
.square-button {
  border: 1px solid transparent;
  background: transparent;
  color: #aab4c6;
  border-radius: 6px;
  height: 32px;
  cursor: pointer;
}

.tool-button:hover,
.icon-button:hover,
.square-button:hover { background: #424b5e; color: white; border-color: #4c5362; }
.toolbar-spacer { flex: 1; }
.history-tools { position: relative; display: flex; align-items: center; flex-shrink: 0; gap: 2px; }
.history-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 27px; height: 30px; padding: 0; border: 1px solid transparent; border-radius: 4px; color: #c4cede; background: transparent; cursor: pointer; }
.history-icon-button:hover:not(:disabled) { background: #424b5e; border-color: #53617a; }
.history-icon-button:disabled { opacity: .35; cursor: not-allowed; }
.history-icon-button:focus-visible { outline: 2px solid #8da8ef; outline-offset: 1px; }

.device-mode-switch {
  display: flex;
  height: 32px;
  padding: 2px;
  background: var(--input);
  border: 1px solid var(--line);
  border-radius: 7px;
}

.device-mode-switch button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #77859a;
  font-size: 10px;
  white-space: nowrap;
  cursor: pointer;
}

.device-mode-switch button span { font-size: 13px; }
.device-mode-switch button:hover { color: #dbe4f2; }
.device-mode-switch button.active { background: #344a9c; color: #fff; box-shadow: 0 2px 8px #0005; }

.screen-select,
.zoom-control {
  height: 32px;
  display: flex;
  align-items: center;
  background: var(--input);
  border: 1px solid var(--line);
  border-radius: 7px;
  color: #8d99ac;
  font-size: 10px;
}

.screen-select > span {
  padding-left: 9px;
  max-width: 95px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.screen-select select,
.zoom-control button { border: 0; background: transparent; color: #d6deeb; height: 100%; }
.screen-select select { padding: 0 7px; max-width: 180px; }
.zoom-control span { width: 44px; text-align: center; }
.zoom-control button { width: 26px; cursor: pointer; }
.icon-button { width: 34px; border-color: var(--line); }
.file-input { display: none; }

.editor-body {
  display: grid;
  grid-template-columns: var(--hierarchy-width) minmax(160px, 1fr) var(--animation-list-width, clamp(150px, 15vw, 200px)) var(--inspector-width);
  min-height: 0;
}
.editor-body.is-animations-collapsed { --animation-list-width: 32px; }

.panel { background: var(--panel); min-height: 0; }
.hierarchy-panel { border-right: 1px solid var(--line); display: flex; flex-direction: column; }
.inspector-panel { border-left: 1px solid var(--line); display: flex; flex-direction: column; }

.panel-heading {
  height: 65px;
  box-sizing: border-box;
  padding: 13px 13px 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  position: relative;
}

.panel-heading h2,
.timeline-title h2 { font-size: 14px; margin: 2px 0 0; }
.square-button { width: 30px; border-color: #4c5362; font-size: 18px; }

.add-menu {
  position: absolute;
  z-index: 20;
  right: 10px;
  top: 50px;
  width: 205px;
  background: #353c49;
  border: 1px solid #525b6d;
  border-radius: 9px;
  padding: 6px;
  box-shadow: 0 12px 30px #0009;
}

.add-menu button {
  width: 100%;
  display: flex;
  gap: 12px;
  align-items: center;
  text-align: left;
  border: 0;
  background: transparent;
  color: #dce5f4;
  padding: 9px;
  border-radius: 6px;
  cursor: pointer;
}

.add-menu button:hover { background: #2d3950; }
.add-menu button > span { width: 25px; height: 25px; display: grid; place-items: center; background: #34425b; border-radius: 5px; color: #78d7e8; }
.add-menu b,
.add-menu small { display: block; }
.add-menu small { color: #8290a7; margin-top: 2px; }

.search-box {
  margin: 10px;
  display: flex;
  align-items: center;
  height: 30px;
  border: 1px solid var(--line);
  background: var(--input);
  border-radius: 7px;
  color: #78869d;
  padding: 0 8px;
}

.search-box input { border: 0 !important; background: transparent !important; color: #dce5f4 !important; font-size: 11px !important; padding: 4px !important; }
.tree { position: relative; flex: 1; overflow: auto; padding: 2px 6px; }
.tree.is-hierarchy-dragging { cursor: grabbing; user-select: none; }

.root-drop-hint {
  position: absolute;
  z-index: 8;
  left: 7px;
  right: 7px;
  top: 3px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #53617a;
  border-radius: 5px;
  background: #151d29e8;
  color: #8e9bb0;
  font-size: 10px;
  pointer-events: none;
}

.root-drop-hint.active { border-color: #61d5e3; background: #17333ae8; color: #83edf5; }

.tree-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 31px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #d6dbe5;
  cursor: pointer;
  text-align: left;
  font-size: 11px;
  padding-right: 8px;
  transition: background .12s, box-shadow .12s, opacity .12s;
}

.tree-row:hover { background: #222c3c; }
.tree-row.selected { color: #fff; background: linear-gradient(90deg, #4059b8, #314375); }
.tree-row.root-node .node-icon { color: #f1c75b; }
.tree-row.dragging { opacity: .35; }
.tree-row.drop-target { background: #1e4850; box-shadow: inset 0 0 0 1px #61d5e3; }
.tree-row.muted { opacity: .48; }
.chevron { width: 14px; color: #7d899b; }
.node-icon { width: 20px; color: #63cde1; font-weight: 700; }
.node-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root-badge { margin-right: 6px; padding: 1px 4px; border: 1px solid #7c6940; border-radius: 3px; color: #e3bd62; font-size: 10px; letter-spacing: .08em; }
.visibility { opacity: .65; }

.hierarchy-drag-ghost {
  position: fixed;
  z-index: 10000;
  display: grid;
  grid-template-columns: 18px auto;
  gap: 1px 5px;
  min-width: 145px;
  padding: 7px 9px;
  border: 1px solid #62dce8;
  border-radius: 6px;
  background: #172532ed;
  color: #e8f4f7;
  box-shadow: 0 10px 25px #0009;
  pointer-events: none;
}

.hierarchy-drag-ghost > span { grid-row: 1 / 3; color: #61d5e3; }
.hierarchy-drag-ghost > b { font-size: 10px; }
.hierarchy-drag-ghost > small { color: #7fc8d0; font-size: 10px; }
.hierarchy-actions { display: flex; gap: 6px; padding: 9px; border-top: 1px solid var(--line); }
.hierarchy-actions button { height: 32px; border: 1px solid #4c5362; border-radius: 6px; background: #353c49; color: #b7c1d1; cursor: pointer; }
.hierarchy-actions .add-control-button { flex: 1; }
.hierarchy-actions .bone-create-toggle { padding: 0 7px; white-space: nowrap; }
.hierarchy-actions .bone-create-toggle.active { background: #335565; border-color: #5ce5ee; color: #b5faff; }
.viewport.is-creating-bones, .viewport.is-creating-bones .canvas-node { cursor: crosshair; }
.bone-root-point { position: absolute; z-index: 25; width: 10px; height: 10px; border: 2px solid #eefbff; border-radius: 50%; background: #46bacb; transform: translate(-50%, -50%); pointer-events: none; }
.bone-create-hint { position: absolute; left: 12px; right: 12px; top: 26px; z-index: 25; width: fit-content; max-width: calc(100% - 24px); padding: 5px 8px; background: #23313dea; color: #b5faff; font-size: 11px; pointer-events: none; }
.bone-draft { opacity: .8; }
.hierarchy-actions button:disabled { opacity: .35; }
.empty-state,
.inspector-empty { color: #a9afbb; text-align: center; font-size: 11px; padding: 25px; }

.workspace-panel { min-width: 0; display: flex; flex-direction: column; background: #414650; }
.workspace-tabs { height: 40px; display: flex; align-items: center; border-bottom: 1px solid var(--line); background: #353a45; padding: 0 9px; }
.workspace-tabs button { height: 100%; padding: 0 15px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #7f8ca0; font-size: 11px; }
.workspace-tabs button.active { color: #e6edf8; border-color: var(--accent); }
.status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #52d59d; margin-right: 7px; }
.workspace-hint { margin-left: auto; color: #a0a7b5; font-size: 10px; }

.viewport {
  position: relative;
  flex: 1;
  overflow: hidden;
  background-color: #494d57;
  background-image: radial-gradient(#5a5e67 1px, transparent 1px);
  background-size: 18px 18px;
}

.viewport.is-panning,
.viewport.is-panning * { cursor: grabbing !important; user-select: none; }

.canvas-stage {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-origin: center;
  background: #3b414c;
  box-shadow: 0 0 0 2px #3a8e9b, 0 20px 80px #0009;
  overflow: visible;
  transition: border-radius .22s ease;
}

.canvas-stage.mobile-frame { border-radius: 28px; box-shadow: 0 0 0 8px #283342, 0 0 0 10px #51a9b5, 0 20px 80px #0009; }
.device-preview-label { position: absolute; left: 0; top: -31px; height: 22px; display: flex; align-items: center; gap: 7px; padding: 0 9px; border: 1px solid #3b485d; border-radius: 5px; background: #17202c; color: #95a4b9; font-size: 10px; white-space: nowrap; pointer-events: none; }
.device-preview-label span { color: #65d4e2; font-size: 13px; }
.safe-area { position: absolute; inset: 4.5%; border: 1px dashed #52627777; pointer-events: none; }
.mobile-frame .safe-area { border-color: #67dbe277; border-radius: 18px; }

.canvas-node { position: absolute; box-sizing: border-box; border: 1.5px solid; display: flex; align-items: center; justify-content: center; cursor: move; user-select: none; }
.canvas-node.selected { outline: 3px solid #62e1ee; outline-offset: 3px; z-index: 10; }
.canvas-node.locked { cursor: not-allowed; }
.image-placeholder { display: flex; flex-direction: column; align-items: center; gap: 9px; color: inherit; }
.image-placeholder span { font-size: 44px; }
.image-placeholder small { letter-spacing: .2em; }
.text-preview { font-size: 30px; font-weight: 700; text-shadow: 0 2px 8px #0008; }
.selection-tag { position: absolute; left: -4px; top: -35px; background: #52cbd8; color: #09222a; padding: 5px 8px; font-size: 13px; font-weight: 700; white-space: nowrap; border-radius: 3px; }
.resize-handle { cursor: nwse-resize; }

.viewport-status { position: absolute; right: 9px; bottom: 8px; display: flex; gap: 12px; color: #bbc2cf; background: #121923d9; border: 1px solid #2a3545; border-radius: 5px; padding: 5px 8px; font-size: 10px; }
.type-badge { padding: 4px 7px; border: 1px solid #364359; border-radius: 5px; color: #8d9bb1; font-size: 10px; }
.inspector-scroll { overflow: auto; flex: 1; }

.property-section { padding: 12px; border-bottom: 1px solid var(--line); }
.property-section h3 { display: flex; align-items: center; gap: 7px; margin: 0 0 12px; font-size: 11px; }
.property-section h3 span { color: #62cede; }
.property-section h3 i { margin-left: auto; color: #68758a; }
.name-field { display: flex; align-items: center; gap: 7px; }
.name-field > span { width: 28px; height: 28px; display: grid; place-items: center; background: #28364a; color: #6ed6e4; border-radius: 5px; }

.name-field input,
.property-row input,
.property-row textarea,
.property-row select,
.number-field input,
.timeline-settings input { background: var(--input) !important; color: #dbe4f2 !important; border: 1px solid var(--line) !important; border-radius: 5px !important; font-size: 11px !important; padding: 7px !important; }

.inline-switches { display: flex; gap: 18px; margin-top: 10px; color: #8491a5; font-size: 10px; }
.inline-switches input { accent-color: var(--accent); }
.coordinate-note { display: flex; align-items: center; gap: 5px; margin-bottom: 8px; padding: 6px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--input); color: #708097; font-size: 10px; }
.coordinate-note span { color: #9ba8bb; }
.coordinate-note b { color: #56c58c; font-weight: 500; }
.coordinate-note i { margin-left: auto; color: #62bddd; font-style: normal; }
.property-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.number-field { display: grid; grid-template-columns: 35px 1fr; align-items: center; min-width: 0; }
.number-field:nth-child(even) .field-label { display: none; }
.field-label { color: #b7bdc9; font-size: 10px; }
.number-field > div { display: flex; align-items: center; background: var(--input); border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
.number-field input { min-width: 0; border: 0 !important; padding: 6px 3px !important; }
.axis { width: 20px; text-align: center; font-size: 10px; }
.axis-x { color: #f26d76; }
.axis-y { color: #6bd593; }
.axis-z { color: #50c6e6; }
.axis-w { color: #50c6e6; }
.axis-h { color: #50c6e6; }

.anchor-type-row { display: flex; align-items: flex-end; gap: 9px; margin-top: 13px; padding-top: 12px; border-top: 1px solid var(--line); }
.anchor-type-row > label { flex: 1; color: #b0b7c5; font-size: 10px; }
.anchor-type-row > label span { display: block; margin-bottom: 5px; }
.anchor-type-row select { width: 100%; height: 30px; padding: 0 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--input); color: #dbe4f2; font-size: 10px; }
.anchor-picker-wrap { position: relative; }
.anchor-preview-button { width: 58px; height: 58px; padding: 6px; border: 1px solid #3c485a; border-radius: 6px; background: var(--input); cursor: pointer; }
.anchor-preview-button:hover { border-color: #607bde; background: #182237; }
.anchor-popover-overlay { position: fixed; inset: 0; z-index: 10000; }
.anchor-preset-popover { position: fixed; box-sizing: border-box; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px; border: 1px solid #3b485e; border-radius: 8px; background: #2c313c; box-shadow: 0 14px 35px #000b; }
.anchor-preset-popover > button { min-width: 0; min-height: 0; padding: 7px; border: 1px solid #343f51; border-radius: 5px; background: #202735; color: #7c8a9e; cursor: pointer; }
.anchor-preset-popover > button:hover,
.anchor-preset-popover > button.active { border-color: #607cff; background: #273451; color: #dce5f5; }
.anchor-preset-popover > button > span:last-child { display: block; margin-top: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 10px; }
.anchor-values { margin-top: 12px; }
.anchor-values-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; color: #d6dbe5; font-size: 10px; }
.anchor-values-title small { color: #a0a7b5; font-size: 10px; }

:deep(.anchor-visual) { --anchor-min-x: 50%; --anchor-min-y: 50%; --anchor-max-x: 50%; --anchor-max-y: 50%; --pivot-x: 50%; --pivot-y: 50%; position: relative; display: block; width: 100%; height: 100%; box-sizing: border-box; border: 1px solid #455166; background: #191f2a; }
:deep(.anchor-bounds) { position: absolute; left: var(--anchor-min-x); right: calc(100% - var(--anchor-max-x)); bottom: var(--anchor-min-y); top: calc(100% - var(--anchor-max-y)); min-width: 1px; min-height: 1px; border: 1px solid #42a9d5; background: #42a9d516; box-sizing: border-box; }
:deep(.anchor-dot) { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: #f3c625; box-shadow: 0 0 0 1px #5d4a04; }
:deep(.anchor-dot-bl) { left: var(--anchor-min-x); bottom: var(--anchor-min-y); transform: translate(-50%, 50%); }
:deep(.anchor-dot-br) { left: var(--anchor-max-x); bottom: var(--anchor-min-y); transform: translate(-50%, 50%); }
:deep(.anchor-dot-tl) { left: var(--anchor-min-x); bottom: var(--anchor-max-y); transform: translate(-50%, 50%); }
:deep(.anchor-dot-tr) { left: var(--anchor-max-x); bottom: var(--anchor-max-y); transform: translate(-50%, 50%); }
:deep(.pivot-mark) { position: absolute; left: var(--pivot-x); bottom: var(--pivot-y); transform: translate(-50%, 50%); display: grid; place-items: center; width: 15px; height: 15px; border-radius: 2px; background: #4d256a; color: #cf6bff; font-size: 10px; line-height: 1; }

.property-row { display: flex; align-items: flex-start; gap: 8px; margin-top: 8px; color: #b0b7c5; font-size: 10px; }
.property-row > span { width: 58px; padding-top: 7px; }
.property-row > input,
.property-row > textarea,
.property-row > select,
.color-field { flex: 1; min-width: 0; }
.property-row > select:disabled { opacity: .65; color: #d5b762 !important; cursor: not-allowed; }
.color-field { display: flex; }
.color-field input[type="color"] { width: 32px; padding: 2px !important; }
.inspector-empty { margin: auto; }
.inspector-empty div { font-size: 30px; color: #445169; }
.inspector-empty p { color: #9aa6b9; margin: 12px 0 5px; }

.timeline-panel { display: grid; grid-template-columns: var(--hierarchy-width) minmax(360px, 1fr) var(--inspector-width); min-height: 0; background: var(--panel); border-top: 1px solid var(--line); }
.timeline-sidebar { border-right: 1px solid var(--line); min-width: 0; }
.timeline-title { height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; border-bottom: 1px solid var(--line); }
.playback-controls { height: 39px; display: flex; align-items: center; gap: 4px; padding: 0 8px; border-bottom: 1px solid var(--line); }
.playback-controls button { width: 29px; height: 25px; border: 0; border-radius: 5px; background: #3e4656; color: #a9b5c8; font-size: 10px; cursor: pointer; }
.playback-controls .play-button { background: var(--accent); color: white; }
.playback-controls span { margin-left: auto; font-family: inherit; color: #99a7bb; font-size: 10px; }
.track-names { overflow: auto; height: calc(100% - 92px); }
.track-names button { display: flex; align-items: center; gap: 8px; width: 100%; height: 33px; border: 0; border-bottom: 1px solid #3c424e; background: transparent; color: #cbd1dc; text-align: left; font-size: 10px; padding: 0 12px; }
.track-names button.selected { background: #3d4e74; color: white; }
.track-names button span { color: #58c6d7; }
.track-names button i { margin-left: auto; }
.timeline-content { position: relative; overflow: hidden; background-color: var(--input); background-image: linear-gradient(90deg, #2c374750 1px, transparent 1px); background-size: 10% 100%; cursor: crosshair; }
.time-ruler { height: 39px; position: relative; border-bottom: 1px solid var(--line); color: #a9afbb; font-size: 10px; }
.time-ruler span { position: absolute; bottom: 8px; transform: translateX(-50%); }
.track-lane { height: 32px; border-bottom: 1px solid #3c424e; position: relative; }
.empty-clip { position: absolute; left: 8px; right: 8px; top: 5px; height: 21px; border: 1px dashed #3d4b61; border-radius: 4px; color: #637189; font-size: 10px; display: flex; align-items: center; justify-content: center; gap: 6px; }
.playhead { position: absolute; z-index: 5; top: 0; bottom: 0; width: 1px; background: #ff6679; pointer-events: none; }
.playhead i { position: absolute; top: 0; left: -4px; width: 9px; height: 10px; background: #ff6679; clip-path: polygon(0 0, 100% 0, 75% 100%, 25% 100%); }
.timeline-settings { padding: 13px; border-left: 1px solid var(--line); color: #8290a4; font-size: 10px; }
.timeline-settings label { display: block; margin-bottom: 15px; }
.timeline-settings select,
.timeline-settings label > div { width: 100%; margin-top: 6px; background: var(--input); border: 1px solid var(--line); border-radius: 5px; color: #c8d2e1; padding: 6px; box-sizing: border-box; }
.timeline-settings label > div { display: flex; padding: 0; align-items: center; }
.timeline-settings input { min-width: 0; border: 0 !important; }
.timeline-settings label > div span { padding-right: 6px; }

@media(max-width:1200px) {
  .editor-body,
  .timeline-panel { grid-template-columns: var(--hierarchy-width) minmax(360px, 1fr) var(--inspector-width); }
  .timeline-panel { grid-template-columns: var(--hierarchy-width) minmax(360px, 1fr) var(--inspector-width); }
  .project-copy { min-width: 140px; }
  .workspace-hint { display: none; }
}

.lua-export-button {
  color: #8ee0ad;
}

.export-wrap,
.import-wrap,
.lua-export-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  height: 32px;
}

.lua-lib-version {
  padding: 3px 6px;
  border: 1px solid #515f79;
  border-radius: 4px;
  color: #b6c7ed;
  background: #354057;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: help;
}

.lua-export-button span {
  margin-left: 3px;
  color: #6f997f;
}

.export-menu,
.import-menu,
.lua-export-menu {
  position: absolute;
  z-index: 80;
  top: 38px;
  left: 0;
  width: 230px;
  padding: 6px;
  border: 1px solid #3a485d;
  border-radius: 8px;
  background: #303743;
  box-shadow: 0 14px 34px #070b12b8;
}

.export-menu button,
.import-menu button,
.lua-export-menu button {
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #c5d0df;
  text-align: left;
  cursor: pointer;
}

.export-menu button:hover,
.import-menu button:hover,
.lua-export-menu button:hover { background: #263449; }
.export-menu button:disabled,
.import-menu button:disabled,
.lua-export-menu button:disabled { opacity: .4; cursor: not-allowed; }
.export-menu button:disabled:hover,
.import-menu button:disabled:hover,
.lua-export-menu button:disabled:hover { background: transparent; }
.export-menu b,
.import-menu b,
.lua-export-menu b,
.export-menu small,
.import-menu small,
.lua-export-menu small { display: block; }
.export-menu b,
.import-menu b,
.lua-export-menu b { font-size: 11px; }
.export-menu small,
.import-menu small,
.lua-export-menu small { margin-top: 3px; color: #78869a; font-size: 10px; }

.tool-button:disabled {
  color: #566173;
  cursor: not-allowed;
  opacity: 0.55;
}

.tool-button:disabled:hover {
  border-color: transparent;
  background: transparent;
}

.gia-import-status {
  max-width: 190px;
  overflow: hidden;
  color: #78c6a3;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rgba-field {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 48px 12px;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.rgba-field input[type="color"] {
  width: 32px;
  height: 30px;
  padding: 2px !important;
}

.rgba-field input[type="number"] {
  min-width: 0;
  text-align: right;
}

.rgba-field i {
  color: #66758a;
  font-style: normal;
}

.rgba-value {
  margin: 5px 0 0 66px;
  color: #a0a7b5;
  font-family: inherit;
  font-size: 10px;
}

.image-type-control select {
  flex: 1;
  min-width: 0;
}

.image-type-control button {
  width: 34px;
  height: 30px;
  border: 1px solid #3a4658;
  border-radius: 5px;
  background: var(--input);
  color: #b9c5d6;
  font-size: 10px;
  cursor: pointer;
}

.image-type-control button:hover {
  border-color: #607cff;
  color: #fff;
}

.tree-row {
  position: relative;
}

.tree-row.drop-inside {
  background: #1e4850;
  box-shadow: inset 0 0 0 1px #61d5e3;
}

.tree-row.drop-before::before,
.tree-row.drop-after::after {
  content: "";
  position: absolute;
  z-index: 9;
  left: 9px;
  right: 5px;
  height: 2px;
  border-radius: 2px;
  background: #69e4ef;
  box-shadow: 0 0 6px #69e4ef88;
}

.tree-row.drop-before::before {
  top: -1px;
}

.tree-row.drop-after::after {
  bottom: -1px;
}

.canvas-node.selected {
  z-index: auto;
}

.text-preview {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 4px;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-weight: 700;
  line-height: 1.2;
  text-shadow: none;
}

.add-menu {
  max-height: min(520px, calc(100vh - 120px));
  overflow-y: auto;
}

.generic-control-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  color: inherit;
  pointer-events: none;
}

.generic-control-preview b {
  font-size: 30px;
  line-height: 1;
}

.generic-control-preview small {
  padding: 3px 6px;
  border-radius: 4px;
  background: #262b35bb;
  font-size: 10px;
}

.runtime-class-name {
  margin: 8px 0 0 35px;
  color: #a9afbb;
  font-family: inherit;
  font-size: 10px;
}

.base-api-note {
  margin-bottom: 8px;
  padding: 6px 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--input);
  color: #a9afbb;
  font-size: 10px;
  line-height: 1.45;
}

.base-toggle-button {
  display: grid;
  grid-template-columns: 1fr 34px 18px auto;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 7px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--input);
  color: #9aa7bb;
  text-align: left;
  cursor: pointer;
}

.base-toggle-button i {
  position: relative;
  width: 32px;
  height: 18px;
  border-radius: 10px;
  background: #303947;
}

.base-toggle-button i::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #8792a3;
  transition: left .15s, background .15s;
}

.base-toggle-button.active i {
  background: #4f6bd1;
}

.base-toggle-button.active i::after {
  left: 17px;
  background: #fff;
}

.base-toggle-button b {
  color: #dbe4f2;
  font-size: 10px;
}

.base-toggle-button small {
  padding: 2px 4px;
  border: 1px solid #665b3b;
  border-radius: 3px;
  color: #d0ad58;
  font-size: 10px;
}

.property-row .api-readonly {
  align-self: center;
  padding: 2px 4px;
  border: 1px solid #665b3b;
  border-radius: 3px;
  color: #d0ad58;
  font-size: 10px;
  white-space: nowrap;
}

.base-switches {
  flex-wrap: wrap;
  gap: 8px 14px;
}

.base-switches small {
  color: #c9a952;
  font-size: 10px;
}

.api-layout-values {
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.reset-image-size {
  height: 25px;
  padding: 0 7px;
  border: 1px solid #3b4658;
  border-radius: 5px;
  background: var(--input);
  color: #d6dbe5;
  cursor: pointer;
}

.timeline-panel,
.timeline-sidebar,
.timeline-content {
  min-height: 0;
  overflow: hidden;
}

.timeline-panel {
  grid-template-columns: var(--hierarchy-width) minmax(360px, 1fr) var(--inspector-width);
  position: relative;
  overflow: visible;
}

.timeline-resize-handle {
  position: absolute;
  z-index: 40;
  top: -6px;
  left: 0;
  right: 0;
  height: 12px;
  border: 0;
  outline: none;
  cursor: row-resize;
  touch-action: none;
}

.timeline-resize-handle::before {
  content: "";
  position: absolute;
  top: 5px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--line);
  transition: background .12s, box-shadow .12s;
}

.timeline-resize-handle span {
  position: absolute;
  z-index: 1;
  top: 3px;
  left: 50%;
  width: 54px;
  height: 6px;
  border: 1px solid #48566c;
  border-radius: 999px;
  background: #1a2230;
  transform: translateX(-50%);
  transition: width .12s, border-color .12s, background .12s;
}

.timeline-resize-handle:hover::before,
.timeline-resize-handle:focus-visible::before,
.is-timeline-resizing .timeline-resize-handle::before {
  background: #607cff;
  box-shadow: 0 0 10px #607cff88;
}

.timeline-resize-handle:hover span,
.timeline-resize-handle:focus-visible span,
.is-timeline-resizing .timeline-resize-handle span {
  width: 72px;
  border-color: #7d92ff;
  background: #334786;
}

.is-timeline-resizing,
.is-timeline-resizing * {
  cursor: row-resize !important;
  user-select: none !important;
}

.timeline-sidebar,
.timeline-content {
  display: flex;
  flex-direction: column;
}

.tween-count {
  padding: 3px 5px;
  border: 1px solid #344154;
  border-radius: 4px;
  color: #a0a7b5;
  font-size: 10px;
}

.track-names {
  position: relative;
  flex: 1;
  height: auto;
  overflow-x: hidden;
  overflow-y: auto;
}

.timeline-name-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px;
  height: 32px;
  border-bottom: 1px solid #3c424e;
  background: var(--panel);
}

.timeline-name-row.row-tween {
  background: #2b303a;
}

.track-names .track-node-main,
.track-names .track-property-main {
  min-width: 0;
  height: 32px;
  padding: 0 8px 0 11px;
  border: 0;
  background: transparent;
  color: #cbd1dc;
}

.track-node-main b,
.track-property-main b {
  overflow: hidden;
  font-size: 10px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-node-main em {
  margin-left: auto;
  color: #59677b;
  font-size: 10px;
  font-style: normal;
}

.timeline-name-row.selected {
  background: #3d4e74;
}

.timeline-name-row.selected .track-node-main,
.timeline-name-row.selected .track-property-main {
  color: #f1f5fb;
}

.track-names .track-property-main {
  padding-left: 28px;
}

.track-property-main > span {
  color: #8e6de9 !important;
  font-size: 10px;
}

.track-property-main small {
  margin-left: auto;
  overflow: hidden;
  color: #a0a7b5;
  font-family: inherit;
  font-size: 10px;
  text-overflow: ellipsis;
}

.track-names .add-tween-button,
.track-names .remove-tween-button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin: 4px 4px 4px 0;
  padding: 0;
  border: 1px solid #40516a;
  border-radius: 5px;
  background: #26334a;
  color: #8fa9ff;
  cursor: pointer;
}

.track-names .add-tween-button:hover {
  border-color: #6984ec;
  background: #334a83;
  color: #fff;
}

.track-names .remove-tween-button {
  border-color: transparent;
  background: transparent;
  color: #a0a7b5;
}

.track-names .remove-tween-button:hover {
  color: #ff7584;
}

.tween-field-picker-backdrop {
  position: fixed;
  z-index: 300;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(20 24 32 / 58%);
  backdrop-filter: blur(2px);
}

.tween-field-picker {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  box-sizing: border-box;
  width: min(700px, calc(100vw - 48px));
  max-height: min(680px, calc(100dvh - 48px));
  overflow: hidden;
  border: 1px solid #626b7c;
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  box-shadow: 0 16px 48px #10151d66;
}

.tween-field-picker-header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 28px;
  gap: 10px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: #2d313b;
}

.tween-field-picker-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid #525d72;
  border-radius: 5px;
  background: #384254;
  color: #d8dfea;
}

.tween-field-picker-heading { min-width: 0; }
.tween-field-picker-header h2 {
  margin: 0 0 4px;
  color: #eef1f6;
  font-size: 14px;
  font-weight: 500;
}

.tween-field-picker-header p {
  overflow: hidden;
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tween-field-picker-header p span { padding: 0 7px; color: #7e8797; }

.tween-field-picker-header > button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #c8ceda;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.tween-field-picker-header > button:hover { background: #43516a; color: #fff; }

.tween-field-picker-search {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 34px;
  margin: 14px 16px 12px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--input);
  color: #bdc5d3;
}
.tween-field-picker-search:focus-within { border-color: #7996de; box-shadow: 0 0 0 2px #527cf31a; }
.tween-field-picker-search input {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 32px;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  color: var(--text);
  font-size: 12px;
  font-weight: 400;
}
.tween-field-picker-search input::placeholder { color: #939dac; }
.tween-field-picker-search > button {
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #bec7d5;
  font-size: 17px;
  cursor: pointer;
}
.tween-field-picker-search > button:hover { background: #43516a; color: white; }

.tween-field-picker-content {
  min-height: 0;
  padding: 0 16px 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.tween-field-picker-group { border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.tween-field-picker-group + .tween-field-picker-group { margin-top: 12px; }
.tween-field-picker-group > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
  background: #353b47;
}
.tween-field-picker-group > header div { display: flex; flex-wrap: wrap; gap: 3px 9px; min-width: 0; align-items: baseline; padding: 7px 0; }
.tween-field-picker-group > header b { color: #dce1eb; font-size: 12px; font-weight: 500; }
.tween-field-picker-group > header small { overflow-wrap: anywhere; color: var(--muted); font-family: inherit; font-size: 10px; }
.tween-field-picker-group > header em { flex: none; color: #b7bfcd; font-size: 10px; font-style: normal; }

.tween-field-picker-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 5px; }
.tween-field-picker-grid button {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 17px;
  grid-template-rows: auto auto;
  gap: 2px 9px;
  align-items: center;
  min-height: 58px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: #384254;
  color: #e0e5ee;
  text-align: left;
  cursor: pointer;
}
.tween-field-picker-grid button:hover:not(:disabled),
.tween-field-picker-grid button:focus-visible:not(:disabled) {
  border-color: #7994d3;
  background: #4c68b0;
  color: #fff;
}
.tween-field-picker-grid .parameter-kind {
  grid-column: 1;
  grid-row: 1 / 3;
  display: grid;
  place-items: center;
  width: 34px;
  height: 28px;
  border: 1px solid #61759870;
  border-radius: 4px;
  background: #465a7c;
  color: #d2def4;
  font-size: 10px;
  font-weight: 500;
}
.tween-field-picker-grid .parameter-kind.kind-color { border-color: #937cab66; background: #665578; color: #ecdcf9; }
.tween-field-picker-grid .parameter-add { grid-column: 3; grid-row: 1 / 3; color: #aebfda; }
.tween-field-picker-grid button b { grid-column: 2; grid-row: 1; min-width: 0; overflow-wrap: anywhere; font-size: 12px; font-weight: 500; line-height: 1.5; }
.tween-field-picker-grid button code { grid-column: 2; grid-row: 2; min-width: 0; color: #b5c1d3; font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.tween-field-picker-grid button small { grid-column: 2 / 4; color: #b5bece; font-size: 10px; line-height: 1.5; }
.tween-field-picker-grid button:hover:not(:disabled) code,
.tween-field-picker-grid button:hover:not(:disabled) small,
.tween-field-picker-grid button:hover:not(:disabled) .parameter-add { color: #e3eafb; }
.tween-field-picker-grid button:disabled { background: #303744; color: #a3aab7; cursor: not-allowed; }
.tween-field-picker-grid button:disabled .parameter-kind { opacity: .6; }
.tween-field-picker-grid button:disabled .parameter-add { opacity: .3; }
.tween-field-picker-grid button:disabled small { color: #d1b38c; }
.tween-value-note.tween-conflict-note { color: #efbd83; }

.tween-field-picker-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 180px; padding: 16px; color: #9eaabd; text-align: center; }
.tween-field-picker-empty b { color: #d0d8e5; font-size: 13px; font-weight: 500; }
.tween-field-picker-empty span { color: var(--muted); font-size: 11px; line-height: 1.5; }

.tween-field-picker > footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 16px; border-top: 1px solid var(--line); background: #2d313b; color: var(--muted); font-size: 11px; }
.tween-field-picker > footer button { flex: none; min-width: 86px; height: 30px; border: 1px solid #6c8cf2; border-radius: 18px; background: var(--accent); color: #fff; font-size: 12px; cursor: pointer; }
.tween-field-picker > footer button:hover { border-color: #a1b8ff; background: #648cfa; }

@media (max-width: 720px) {
  .tween-field-picker-grid { grid-template-columns: 1fr; }
}

.timeline-content {
  background: var(--input);
  cursor: default;
}

.timeline-content-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  box-sizing: border-box;
  padding: 0 11px;
  border-bottom: 1px solid var(--line);
  color: #8f9caf;
  font-size: 10px;
}

.timeline-content-heading small {
  color: #526075;
  font-size: 10px;
}

.timeline-track-heading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 10px;
}

.timeline-track-heading > span {
  flex: 0 0 auto;
  color: #aeb9c9;
  font-weight: 600;
}

.timeline-track-heading small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-heading-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
}

.timeline-snap-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid #515c6f;
  border-radius: 5px;
  background: var(--input);
  color: #aab5c7;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.timeline-snap-toggle.active { color: #cceeff; border-color: #4c9eb7; background: #294955; }
.timeline-snap-toggle:focus-visible, .tween-relative-toggle:focus-visible { outline: 2px solid #7acbdf; outline-offset: 2px; }
.timeline-snap-guide { position: absolute; top: 0; z-index: 8; width: 0; border-left: 1px dashed #79e1e6; pointer-events: none; }
.timeline-snap-guide span { position: absolute; top: 2px; right: 4px; padding: 2px 4px; border-radius: 3px; color: #d9ffff; background: #244951; font-size: 10px; white-space: nowrap; }
.tween-relative-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; margin: 0 0 10px; padding: 7px 8px; border: 1px solid #515c6f; border-radius: 5px; color: #bdc7d8; background: var(--input); font-size: 11px; cursor: pointer; }
.tween-relative-toggle b { padding: 2px 8px; border-radius: 10px; background: #485364; font-size: 10px; }
.tween-relative-toggle.active { border-color: #647fff; }
.tween-relative-toggle.active b { background: #526fec; color: white; }

.space-play-hint {
  color: #a0a7b5;
  font-size: 10px;
  white-space: nowrap;
}

.space-play-hint kbd {
  display: inline-flex;
  height: 18px;
  padding: 0 6px;
  align-items: center;
  border: 1px solid #3b4658;
  border-bottom-color: #566379;
  border-radius: 4px;
  background: var(--input);
  color: #a7b2c3;
  font-family: inherit;
  font-size: 10px;
  box-shadow: 0 1px 0 #0008;
}

.sequence-duration-control {
  display: flex;
  height: 28px;
  align-items: center;
  overflow: hidden;
  border: 1px solid #4c5362;
  border-radius: 5px;
  background: var(--input);
  color: #7e8ba0;
  white-space: nowrap;
}

.sequence-duration-control > span { padding-left: 8px; font-size: 10px; }
.sequence-duration-control input {
  width: 50px;
  height: 100%;
  box-sizing: border-box;
  margin-left: 7px;
  padding: 0 3px;
  border: 0;
  border-left: 1px solid var(--line);
  background: #0e1520;
  color: #dce5f2;
  font-size: 10px;
  text-align: right;
  outline: none;
}

.sequence-duration-control input:focus { background: #182237; box-shadow: inset 0 0 0 1px #607cff; }
.sequence-duration-control i { padding: 0 7px 0 3px; color: #637087; font-size: 10px; font-style: normal; }

.time-ruler {
  flex: 0 0 39px;
  box-sizing: border-box;
  background: var(--panel);
  cursor: ew-resize;
  touch-action: none;
}

.timeline-lanes {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  background-color: var(--input);
  background-image: linear-gradient(90deg, #2c374750 1px, transparent 1px);
  background-size: 10% 100%;
  cursor: crosshair;
  touch-action: none;
}

.timeline-lanes.scrubbing { cursor: ew-resize; }

.track-lane {
  box-sizing: border-box;
  height: 33px;
}

.track-lane.lane-node {
  background: #18202c99;
}

.track-lane.selected {
  background-color: #1c2a3c99;
}

.empty-track-hint {
  position: absolute;
  inset: 6px 9px;
  display: grid;
  place-items: center;
  border: 1px dashed #3b485b;
  border-radius: 4px;
  color: #5c6b80;
  font-size: 10px;
}

.tween-clip {
  position: absolute;
  z-index: 2;
  top: 5px;
  display: flex;
  align-items: center;
  height: 23px;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid #586fc5;
  border-radius: 4px;
  background: linear-gradient(90deg,#334a91,#26396f);
  color: #cfd9ff;
  font-family: inherit;
  font-size: 10px;
  cursor: grab;
  touch-action: none;
}

.tween-clip:hover,
.tween-clip.selected-clip {
  border-color: #82a0ff;
  background: linear-gradient(90deg,#405db2,#304887);
}

.tween-clip.dragging {
  z-index: 6;
  cursor: grabbing;
  border-color: #9cb3ff;
  box-shadow: 0 4px 14px #0008;
}

.tween-clip.resizing-start,
.tween-clip.resizing-end {
  cursor: ew-resize;
}

.tween-clip > span {
  display: block;
  flex: 1;
  overflow: hidden;
  padding: 0 13px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tween-edge-handle {
  position: absolute;
  z-index: 2;
  top: -1px;
  bottom: -1px;
  width: 14px;
  cursor: ew-resize;
  touch-action: none;
}

.tween-edge-handle::after {
  position: absolute;
  top: 8px;
  width: 7px;
  height: 7px;
  content: "";
  transform: rotate(45deg);
  border: 1px solid #26304a;
  background: #f0c85b;
}

.edge-start { left: -1px; }
.edge-start::after { left: 5px; }
.edge-end { right: -1px; }
.edge-end::after { right: 5px; }

.playhead {
  /* Clip owns pointer hits at crossings; the separate line stays visible above it. */
  z-index: 1;
  bottom: auto;
  min-height: 100%;
  background: transparent;
  pointer-events: auto;
  cursor: ew-resize;
  touch-action: none;
}

.playhead-line {
  position: absolute;
  z-index: 7;
  top: 0;
  bottom: auto;
  width: 1px;
  min-height: 100%;
  background: #ff6679;
  pointer-events: none;
}

.playhead::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -7px;
  width: 15px;
}

.playhead i {
  pointer-events: none;
  transition: transform .1s, filter .1s;
}

.playhead:hover i,
.playhead:focus-visible i,
.playhead.scrubbing i {
  transform: scale(1.3);
  filter: drop-shadow(0 0 4px #ff6679);
}

.playhead:focus-visible { outline: none; }

.is-timeline-scrubbing,
.is-timeline-scrubbing * {
  cursor: ew-resize !important;
  user-select: none !important;
}

.timeline-settings {
  padding: 0 12px 12px;
  overflow-x: hidden;
  overflow-y: auto;
}

.timeline-settings-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  margin: 0 -12px 13px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
  color: #a0a7b5;
  font-size: 10px;
}

.timeline-settings-heading b {
  color: #9aa7ba;
  font-size: 10px;
  max-width: 145px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-tween-summary {
  display: grid;
  gap: 3px;
  margin-bottom: 12px;
  padding: 8px;
  border: 1px solid #32415a;
  border-radius: 6px;
  background: #182235;
}

.selected-tween-summary b {
  color: #dbe4f5;
  font-size: 10px;
}

.selected-tween-summary span,
.selected-tween-summary small {
  overflow: hidden;
  color: #7f8da3;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-tween-summary small {
  color: #718fe9;
  font-family: inherit;
}

.tween-time-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}

.timeline-settings .tween-time-grid label,
.tween-value-field {
  min-width: 0;
  margin-bottom: 10px;
}

.tween-ease-field {
  display: block;
  margin-bottom: 10px;
}

.tween-ease-field select {
  box-sizing: border-box;
  width: 100%;
  margin-top: 6px;
}

.tween-value-field input {
  box-sizing: border-box;
  width: 100%;
  margin-top: 6px;
}

.tween-value-note {
  margin: 10px 0 0;
  padding: 7px;
  border-left: 2px solid #526bc5;
  background: #2c323e;
  color: #68768b;
  font-size: 10px;
  line-height: 1.5;
}

.tween-settings-editor :deep(.rgba-control) {
  margin-top: 8px;
}

.api-layout-note {
  margin: 0 0 8px;
  color: #a9afbb;
  font-size: 10px;
  line-height: 1.45;
}

.api-layout-grid,
.api-tween-readout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.api-layout-grid label,
.api-tween-readout > div {
  min-width: 0;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--input);
}

.api-layout-grid code,
.api-tween-readout code {
  display: block;
  overflow: hidden;
  color: #69bddd;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-layout-grid input {
  box-sizing: border-box;
  width: 100%;
  margin-top: 4px;
  padding: 2px 0 !important;
  border: 0 !important;
  background: transparent !important;
  color: #e1e9f5 !important;
  font-size: 10px !important;
}

.api-tween-readout {
  margin-top: 7px;
}

.api-tween-readout > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  padding: 5px 6px;
}

.api-tween-readout b {
  color: #cfd8e7;
  font-size: 10px;
  font-weight: 500;
}

@media(max-width:1200px) {
  .timeline-panel {
    grid-template-columns: var(--hierarchy-width) minmax(360px, 1fr) var(--inspector-width);
  }

  .space-play-hint,
  .timeline-track-heading small {
    display: none;
  }
}

/* Compact editor chrome, shared by the scene, inspector and timeline. */
.animation-editor :deep(*) { scrollbar-width: thin; scrollbar-color: #626977 transparent; }
.animation-editor :deep(button:focus-visible),
.animation-editor :deep(summary:focus-visible),
.animation-editor a:focus-visible { outline: 2px solid #89a6ff; outline-offset: -2px; }
.animation-editor :deep(input:focus-visible),
.animation-editor select:focus-visible { outline: 1px solid #89a6ff; outline-offset: -1px; }
button { transition: background .12s, border-color .12s; }
.editor-toolbar { gap: 6px; padding: 0 12px; background: #2d313b; }
.tool-button, .icon-button, .square-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex-shrink: 0; color: #d9dde7; font-size: 12px; }
.tool-button { padding: 0 9px; white-space: nowrap; }
.back-button { border: 0; text-decoration: none; }
.project-copy { min-width: 100px; max-width: 220px; flex: 0 1 190px; gap: 2px; }
.project-copy strong { overflow: hidden; text-overflow: ellipsis; font-size: 14px; white-space: nowrap; }
.project-copy > span { overflow: hidden; color: #a3aab8; font-family: inherit; font-size: 10px; letter-spacing: 0; text-overflow: ellipsis; white-space: nowrap; }
.title-slash { color: #7b8292; }
.gia-import-button { color: #d9dde7; }
.lua-export-button { border-color: #536790; color: #c4d1f5; background: #3d4964; }
.lua-export-button span { color: inherit; }
.screen-select { gap: 6px; padding-left: 9px; color: #dbe0ea; }
.screen-select select { font-size: 12px; }
.zoom-control { font-size: 12px; }
.zoom-control button { color: #c8cfdb; }
.zoom-control button:hover { background: #3d4555; }
.panel-heading { height: 44px; flex-shrink: 0; padding: 8px 12px; }
.panel-heading h2 { font-size: 12px; font-weight: 500; margin: 0; color: #d5dae5; }
.heading-count { margin-left: 7px; color: #989fad; font-family: inherit; font-size: 11px; }
.square-button { height: 26px; width: 26px; border: 0; }
.search-box { flex-shrink: 0; height: 32px; border-radius: 18px; margin: 10px 10px 14px; gap: 5px; color: #c1c7d2; }
.search-box input { min-width: 0; font-size: 12px !important; font-weight: 400; }
.search-box input::placeholder { color: #939ba9; }
.search-clear { padding: 0; border: 0; background: none; color: #bdc4d1; cursor: pointer; }
.tree { padding: 0 5px; }
.tree-row { height: 33px; margin-bottom: 3px; border-radius: 4px; background: #384254; color: #e1e5ed; font-size: 12px; }
.tree-row:hover { background: #45536c; }
.tree-row.selected { background: #4c68b0; box-shadow: inset 0 0 0 1px #6a85ca66; }
.tree-row.root-node .node-icon, .node-icon { flex-shrink: 0; color: #d8dfea; margin-right: 5px; }
.chevron { flex-shrink: 0; font-size: 16px; color: #d5dbea; }
.visibility { display: flex; align-items: center; padding-left: 4px; color: #d5def0; }
.hierarchy-actions { border: 0; padding: 12px 10px; }
.hierarchy-actions button { display: flex; align-items: center; justify-content: center; gap: 5px; background: transparent; border-color: #8b919e; border-radius: 18px; font-size: 12px; }
.hierarchy-actions button:last-child { width: 32px; border-color: #515966; border-radius: 6px; }
.hierarchy-actions button:hover:not(:disabled) { background: #414d65; border-color: #b4bfd7; }
.workspace-tabs { height: 36px; flex-shrink: 0; gap: 12px; padding: 0 14px; }
.workspace-label { display: flex; align-items: center; gap: 7px; color: #d4dbe8; font-size: 11px; white-space: nowrap; }
.workspace-hint { color: #a2aab9; font-size: 10px; }
.canvas-ratio { margin-left: auto; font-family: inherit; font-size: 10px; color: #a8b0be; }
.workspace-tabs .bone-mode-toggle, .workspace-tabs .bone-visibility-toggle { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 5px; height: 25px; padding: 0 8px; white-space: nowrap; border: 1px solid #515b6b; border-radius: 4px; color: #a7b1c2; }
.workspace-tabs .bone-mode-toggle.active, .workspace-tabs .bone-visibility-toggle.active { border-color: #4a8d9d; background: #2b444e; color: #9be4ee; }
.workspace-tabs .bone-mode-toggle:focus-visible, .workspace-tabs .bone-visibility-toggle:focus-visible { outline: 2px solid #5ce5ee; outline-offset: 2px; }
.workspace-tabs .bone-mode-toggle:disabled, .workspace-tabs .bone-visibility-toggle:disabled { opacity: .45; cursor: not-allowed; }
.viewport { background-image: radial-gradient(#777d8940 .85px, transparent .85px); background-size: 16px 16px; }
.canvas-stage {
  /* Fit the current device canvas height; aspect changes reveal or crop the sides. */
  background: #3b424d url("@/assets/ClientUIAnimationEditor/UIPage.png") center / auto 100% no-repeat;
  box-shadow: 0 0 0 1px #8399a3, 0 8px 32px #1c212740;
}
.canvas-stage.mobile-frame { box-shadow: 0 0 0 6px #303642, 0 0 0 7px #8299a6, 0 8px 32px #1c212740; }
.device-preview-label { height: auto; top: -29px; padding: 0; background: transparent; border: 0; border-radius: 0; color: #d5dbe5; font-size: 18px; }
.safe-area { border-color: #c4cad226; }
.viewport-status { background: #363c47dd; color: #c0c8d5; border-color: #5d657570; font-size: 10px; }
.canvas-node.selected { outline: 2px solid #5ce5ee; outline-offset: 0; }
.canvas-node.bone-attach-hover { outline: 3px solid #ffe394; outline-offset: 2px; box-shadow: 0 0 12px #ffd66b99; cursor: pointer; }
.selection-tag { top: -29px; left: 0; padding: 3px 6px; background: #353e4bea; color: #a8f4fa; border-radius: 2px; font-size: 15px; font-weight: 400; }
.selection-corner { position: absolute; width: 10px; height: 10px; border: 2px solid #434d58; border-radius: 50%; background: #eff6f7; pointer-events: none; }
.corner-tl { top: -7px; left: -7px; }
.corner-tr { top: -7px; right: -7px; }
.corner-bl { bottom: -7px; left: -7px; }
.corner-br { bottom: -7px; right: -7px; }
.resize-handle { pointer-events: auto; touch-action: none; }
.resize-handle.corner-tr, .resize-handle.corner-bl { cursor: nesw-resize; }
.selection-pivot { position: absolute; width: 10px; height: 10px; border: 3px solid #5ce5ee; border-radius: 50%; transform: translate(-50%, 50%); pointer-events: none; }
.canvas-transform-toolbar { display: flex; align-items: center; gap: 5px; flex: 0 0 auto; min-height: 43px; padding: 6px 10px; border-top: 1px solid #505968; background: #303743; }
.canvas-transform-toolbar button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: 0 0 auto; padding: 6px 10px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #c4cedc; font-size: 12px; cursor: pointer; }
.canvas-transform-toolbar button:hover { background: #444e5d; color: #fff; }
.canvas-transform-toolbar button.active { border-color: #5ce5ee75; background: #5ce5ee1c; color: #a8f4fa; }
.canvas-transform-toolbar button:focus-visible, .rotation-handle:focus-visible { outline: 2px solid #5ce5ee; outline-offset: 2px; }
.canvas-transform-hint { margin-left: 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #99a6b9; font-size: 11px; }
.tool-rotate .canvas-node:not(.locked) { cursor: crosshair; }
.tool-scale .canvas-node:not(.locked) { cursor: nwse-resize; }
.canvas-node { touch-action: none; }
.transform-gizmo { position: absolute; width: 0; height: 0; z-index: 12; pointer-events: none; }
.transform-gizmo-lines, .scale-gizmo { position: absolute; overflow: visible; }
.transform-gizmo-lines { stroke: #5ce5ee; stroke-width: 1.5; }
.rotation-handle { position: absolute; display: flex; align-items: center; justify-content: center; width: 25px; height: 25px; padding: 0; transform: translate(-50%, -50%); border: 1px solid #5ce5ee; border-radius: 50%; background: #303743; color: #c8faff; pointer-events: auto; touch-action: none; cursor: grab; }
.rotation-handle:hover { background: #426572; }
.rotation-handle:active { cursor: grabbing; }
.rotation-gizmo { position: absolute; left: -58px; top: -58px; overflow: visible; }
.rotation-ring-hit { fill: none; stroke: transparent; stroke-width: 16; pointer-events: stroke; touch-action: none; cursor: crosshair; }
.rotation-ring { fill: none; stroke: #ff665e; stroke-width: 2; }
.rotation-ring-hit:hover + .rotation-ring { stroke: #ffaaa4; stroke-width: 3; }
.rotation-ticks { fill: none; stroke: #ff938b; stroke-width: 1.5; }
.rotation-radius { stroke: #5ce5ee; stroke-width: 1.5; }
.rotation-center { fill: #303743; stroke: #8eeef5; stroke-width: 2; }
.scale-axis { fill: #ff736b; stroke: #ff736b; stroke-width: 2; cursor: ew-resize; pointer-events: auto; touch-action: none; }
.scale-axis.axis-y { fill: #83e49b; stroke: #83e49b; cursor: ns-resize; }
.scale-axis-hit { stroke: transparent; stroke-width: 16; pointer-events: stroke; }
.scale-axis text { font: 11px sans-serif; stroke: none; pointer-events: none; }
.scale-axis:hover rect { fill: #fff; }
.scale-uniform { fill: #303743; stroke: #b9f6fa; stroke-width: 2; pointer-events: auto; touch-action: none; cursor: nwse-resize; }
.scale-uniform:hover { fill: #5ce5ee; }
.bone-length-handle { position: absolute; z-index: 13; width: 12px; height: 12px; padding: 0; transform: translate(-50%, -50%) rotate(45deg); border: 1.5px solid #b9f6fa; border-radius: 2px; background: #303743; touch-action: none; }
.bone-length-handle::before { content: ""; position: absolute; inset: -5px; }
.bone-length-handle:hover, .bone-length-handle:active { background: #5ce5ee; border-color: #fff; }
.bone-length-handle:focus-visible { outline: 2px solid #5ce5ee; outline-offset: 3px; }
.direction-length-field { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #bfc8d7; }
.direction-length-field > span { flex: 0 0 auto; }
.direction-length-field > input { flex: 1; width: 0; min-width: 0; padding: 7px 9px; border: 1px solid #414c5d; border-radius: 5px; background: #242b36; color: #edf3ff; }
.direction-length-field > i { flex: 0 0 auto; font-style: normal; color: #8996ac; }
.direction-guide-note { margin: 9px 0 0; color: #8996ac; font-size: 11px; line-height: 1.7; }
.inspector-heading { height: 66px; border: 0; padding: 10px 14px 6px; color: #c7cedb; }
.inspector-identity { min-width: 0; flex: 1; }
.inspector-name { display: block; width: 100%; padding: 2px 0 !important; border: 1px solid transparent !important; background: transparent !important; color: #f0f2f6 !important; font-size: 16px !important; font-weight: 500 !important; }
.inspector-name:hover { border-bottom-color: #69768f !important; }
.inspector-identity > span { display: block; margin-top: 3px; color: #a9b0bd; font-size: 10px; }
.identity-separator { padding: 0 7px; color: #788293; }
.inspector-tabs { display: flex; flex-shrink: 0; height: 30px; margin: 4px 12px 8px; padding: 2px; border: 1px solid #444b58; border-radius: 20px; background: #2b303b; }
.inspector-tabs button { flex: 1; border: 0; border-radius: 18px; background: transparent; color: #b8c0cd; font-size: 12px; cursor: pointer; }
.inspector-tabs button.active { background: var(--accent); color: #fff; }
.inspector-tabs button:hover:not(.active) { background: #3d4657; }
.inspector-scroll { padding-bottom: 8px; }
.property-action-feedback { margin: 2px 9px 6px; padding: 6px 9px; border: 1px solid #4b638a; border-radius: 5px; background: #354460; color: #cedcf8; font-size: 11px; line-height: 1.5; }
.property-section { margin: 6px 8px; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.property-section :deep(summary) { display: flex; align-items: center; min-height: 34px; box-sizing: border-box; padding: 8px 11px; color: #e2e6ee; font-size: 12px; font-weight: 500; list-style: none; cursor: pointer; user-select: none; }
.property-section :deep(summary::-webkit-details-marker) { display: none; }
.property-section :deep(.section-chevron) { margin-right: 8px; color: #c7ceda; transition: transform .12s; }
.property-section[open] :deep(.section-chevron) { transform: rotate(90deg); }
.property-section :deep(.section-grip) { margin-left: auto; color: #a8b0bf; font-size: 17px; line-height: 12px; }
.property-section :deep(.property-section-body) { padding: 0 11px 11px; }
.device-field > span { display: block; color: #b7bfcd; font-size: 11px; margin: 5px 0 7px; }
.device-mode-switch { width: 100%; box-sizing: border-box; gap: 6px; padding: 0; border: 0; background: transparent; }
.device-mode-switch button { position: relative; justify-content: center; flex: 1; padding: 0; color: #b7bfcd; }
.device-mode-switch button.active { background: #5077d2; box-shadow: none; }
.device-mobile-mark { position: absolute; right: 5px; bottom: 2px; font-family: inherit; font-size: 8px !important; }
.coordinate-note { justify-content: flex-end; gap: 2px; margin: 8px 0 0; padding: 0; border: 0; background: transparent; font-size: 11px; }
.coordinate-note span { color: #b7bfcd; }
.coordinate-note span:last-child { font-size: 9px; color: #929cab; }
.property-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px 6px; }
.number-field { display: flex; flex-direction: column; align-items: stretch; gap: 5px; }
.full-width-number { grid-column: 1 / -1; }
.secondary-transform { margin: 9px 0 0; }
.secondary-transform > summary { display: list-item; min-height: 0; padding: 5px 0; color: #a5afbf; font-size: 10px; list-style: revert; }
.secondary-transform[open] > summary { margin-bottom: 6px; }
.number-field :deep(.field-label) { height: 14px; color: #bac1cd; font-size: 11px; }
.number-field:nth-child(even) :deep(.field-label) { display: block; visibility: hidden; }
.number-field :deep(div) { display: flex; align-items: center; height: 30px; box-sizing: border-box; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: var(--input); }
.number-field :deep(input) { flex: 1; min-width: 0; width: 100%; height: 28px; padding: 0 4px !important; border: 0 !important; background: transparent !important; color: #e4e7ef !important; font-family: inherit; font-size: 13px !important; font-weight: 600; }
.number-field :deep(.axis) { flex-shrink: 0; width: 17px; margin-left: 5px; border-radius: 2px; text-align: center; font-family: inherit; font-size: 13px; line-height: 18px; }
.number-field :deep(.axis-x) { color: #f4858d; background: #bc475433; }
.number-field :deep(.axis-y) { color: #a1d275; background: #6e9c4233; }
.number-field :deep(.axis-z), .number-field :deep(.axis-w), .number-field :deep(.axis-h) { color: #50c6e6; background: #2485ac33; }
.anchor-type-row { align-items: center; border: 0; margin-top: 12px; padding-top: 0; }
.anchor-type-row > label, .anchor-type-row select { font-size: 11px; }
.anchor-values-title { color: #bac1cd; font-size: 11px; }
.anchor-values-title small { font-size: 9px; color: #929cab; }
.anchor-preview-button { width: 52px; height: 52px; }
.setting-switch { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 31px; color: #c6cdda; font-size: 11px; cursor: pointer; }
.setting-switch input { appearance: none; flex-shrink: 0; position: relative; width: 36px; height: 20px; margin: 0; padding: 0; border: 1px solid #697487; border-radius: 14px; background: #495362; cursor: pointer; }
.setting-switch input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #d9e0e8; transition: transform .15s; }
.setting-switch input:checked { border-color: var(--accent); background: var(--accent); }
.setting-switch input:checked::after { transform: translateX(16px); background: #fff; }
.runtime-heading { display: grid; gap: 6px; padding: 12px; }
.runtime-heading b { overflow-wrap: anywhere; color: #d1ddf5; font-family: inherit; font-size: 12px; font-weight: 400; }
.runtime-heading span { color: #adb6c4; font-size: 11px; }
.api-layout-grid code, .api-tween-readout code { font-size: 10px; }
.api-layout-note { font-size: 11px; line-height: 1.65; }
.timeline-title { height: 44px; flex-shrink: 0; box-sizing: border-box; }
.timeline-title h2 { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 12px; font-weight: 500; }
.timeline-content-heading { height: 44px; min-height: 44px; }
.timeline-settings-heading { height: 44px; box-sizing: border-box; font-size: 11px; }
.timeline-settings-heading b { max-width: 200px; font-size: 11px; }
.playback-controls { flex-shrink: 0; box-sizing: border-box; height: 36px; }
.playback-controls button { display: flex; align-items: center; justify-content: center; background: #414b5f; }
.playback-controls .play-button { background: var(--accent); }
.time-ruler { height: 36px; flex-basis: 36px; font-size: 10px; }
.timeline-name-row { background: #303743; }
.timeline-name-row.selected { background: #3f5077; }
.timeline-name-row.row-tween { background: #2b303b; }
.track-node-main b, .track-property-main b { font-size: 11px; }
.track-property-main small { display: none; }
.track-lane.lane-node { background: #3e475550; }
.track-lane.selected { background-color: #465f8940; }
.timeline-lanes { background-color: #292f3a; background-image: linear-gradient(90deg, #59617040 1px, transparent 1px); }
.empty-track-hint { border-color: #556078; color: #a4afc2; }
.timeline-resize-handle::before { background: #505969; }
.timeline-resize-handle span { border-color: #737e91; background: #394251; }
.timeline-track-heading > span { color: #c7d0df; }
.sequence-duration-control { color: #b0baca; }
.sequence-duration-control input { background: var(--input); font-size: 12px; }
.tween-value-note { color: #aab5c7; font-size: 11px; }
.tween-clip { font-size: 10px; }
.selected-tween-summary { background: #343f54; }
.selected-tween-summary b { font-size: 12px; }
.timeline-settings { font-size: 11px; }
.timeline-settings input { font-size: 12px !important; }

@media (max-width: 1200px) {
  .animation-editor { --hierarchy-width: 220px; --inspector-width: 286px; }
  .project-copy { min-width: 100px; }
  .tool-button { padding: 0 6px; }
  .screen-select select { max-width: 163px; }
}
@media (prefers-reduced-motion: reduce) {
  .animation-editor :deep(*) { transition: none !important; }
}
</style>
