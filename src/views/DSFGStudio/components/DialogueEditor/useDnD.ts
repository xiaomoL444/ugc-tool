import { Node, Position, useVueFlow } from "@vue-flow/core";
import { ref, watch } from "vue";
import type { FlowNodeData } from "./types/FileStruct";

export const DIALOGUE_NODE_GRID_SIZE = 20;

function snapToDialogueGrid(value: number) {
  return (
    Math.round(value / DIALOGUE_NODE_GRID_SIZE) * DIALOGUE_NODE_GRID_SIZE
  );
}

/**
 * @returns {string} - A unique id.
 */
function getId() {
  return `dndnode_${crypto.randomUUID()}`;
}

/**
 * In a real world scenario you'd want to avoid creating refs in a global scope like this as they might not be cleaned up properly.
 * @type {{draggedType: Ref<string|null>, isDragOver: Ref<boolean>, isDragging: Ref<boolean>}}
 */
const state = {
  /**
   * The type of the node being dragged.
   */
  draggedType: ref<string | null>(null),
  isDragOver: ref(false),
  isDragging: ref(false),
};

export default function useDragAndDrop(
  onCreateDialogueNode?: (nodeId: string) => void,
  onCreateConditionBranchNode?: (nodeId: string) => void,
) {
  const { draggedType, isDragOver, isDragging } = state;

  const { addNodes, screenToFlowCoordinate, onNodesInitialized, updateNode } =
    useVueFlow();

  watch(isDragging, (dragging) => {
    document.body.style.userSelect = dragging ? "none" : "";
  });

  function onDragStart(event: any, type: any) {
    if (event.dataTransfer) {
      event.dataTransfer.setData("application/vueflow", type);
      event.dataTransfer.effectAllowed = "move";
    }

    draggedType.value = type;
    isDragging.value = true;

    document.addEventListener("drop", onDragEnd);
  }

  /**
   * Handles the drag over event.
   *
   * @param {DragEvent} event
   */
  function onDragOver(event: any) {
    event.preventDefault();

    if (draggedType.value) {
      isDragOver.value = true;

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    }
  }

  function onDragLeave() {
    isDragOver.value = false;
  }

  function onDragEnd() {
    isDragging.value = false;
    isDragOver.value = false;
    draggedType.value = null;
    document.removeEventListener("drop", onDragEnd);
  }

  /**
   * Handles the drop event.
   *
   * @param {DragEvent} event
   */
  function onDrop(event: any) {
    const position = screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY,
    });

    const nodeId = getId();
    if (!draggedType.value) return;
    const nodeType = draggedType.value === "customer" ? "custom" : draggedType.value;
    const dialogueNodeId =
      nodeType === "entry" ||
      nodeType === "output" ||
      nodeType === "condition"
        ? undefined
        : nodeId;
    const conditionBranchNodeId =
      nodeType === "condition" ? nodeId : undefined;

    if (dialogueNodeId) {
      onCreateDialogueNode?.(dialogueNodeId);
    }
    if (conditionBranchNodeId) {
      onCreateConditionBranchNode?.(conditionBranchNodeId);
    }

    const newNode: Node<FlowNodeData> = {
      id: nodeId,
      type: nodeType,
      position,
      data: dialogueNodeId
        ? { dialogueNodeId }
        : conditionBranchNodeId
          ? { conditionBranchNodeId }
          : {},
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };

    /**
     * Align node position after drop, so it's centered to the mouse
     *
     * We can hook into events even in a callback, and we can remove the event listener after it's been called.
     */
    const { off } = onNodesInitialized(() => {
      updateNode(nodeId, (node) => ({
        position: {
          x: snapToDialogueGrid(
            node.position.x - node.dimensions.width / 2,
          ),
          y: snapToDialogueGrid(
            node.position.y - node.dimensions.height / 2,
          ),
        },
      }));

      off();
    });

    addNodes(newNode);
  }

  return {
    draggedType,
    isDragOver,
    isDragging,
    onDragStart,
    onDragLeave,
    onDragOver,
    onDrop,
  };
}
