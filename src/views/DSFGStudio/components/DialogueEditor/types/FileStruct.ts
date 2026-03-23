import { Edge, Node } from "@vue-flow/core";

export interface DialogueProject {
  tree: any;
  flow: FlowLayout;
}

export interface FlowLayout {
  nodes: Node[];
  edges: Edge[];
}
