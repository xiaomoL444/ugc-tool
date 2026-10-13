import type { ControlPropertyField } from './controlRegistry';

/** Presentation only: hidden values remain in the project and animation tracks. */
export function imageMaskFields(fields: ControlPropertyField[], values: Record<string, unknown>): ControlPropertyField[] {
  const find = (key: string, label?: string) => {
    const field = fields.find(item => item.key === key)!;
    return label ? { ...field, label } : field;
  };
  const result = [find('enableMask', 'clientUIAnimationEditor.ui.imageMask.enableMask')];
  if (!values.enableMask) return result;
  result.push(find('enableSoftEdge', 'clientUIAnimationEditor.ui.imageMask.softEdge'));
  if (values.enableSoftEdge) {
    result.push({ ...find('softEdgeMode'), options: [{value:'pixel',label:"clientUIAnimationEditor.ui.imageMask.pixels"}, {value:'percentage',label:"clientUIAnimationEditor.ui.imageMask.percentage"}] });
    if (values.softEdgeMode !== 'percentage') result.push(find('softEdgeWidthX', 'clientUIAnimationEditor.ui.imageMask.featherWidthHorizontal'), find('softEdgeWidthY', 'clientUIAnimationEditor.ui.imageMask.featherWidthY'));
    if (values.softEdgeMode === 'percentage') result.push(find('horizontalSoftRange', 'clientUIAnimationEditor.ui.imageMask.horizontalAreaRange'), find('verticalSoftRange', 'clientUIAnimationEditor.ui.imageMask.verticalAreaRange'));
  }
  result.push({key:'__fillEnabled',label:"clientUIAnimationEditor.ui.controls.image.fillByProgress",kind:'boolean'});
  if (values.enableFill ?? (values.fillType && values.fillType !== 'unused')) {
    result.push({...find('fillType', 'clientUIAnimationEditor.ui.imageMask.shape'), options: find('fillType').options?.filter(item => item.value !== 'unused')});
    if (values.fillType === 'horizontal') result.push({...find('fillHorizontalType','clientUIAnimationEditor.ui.imageMask.direction'), options:[{value:'left',label:"clientUIAnimationEditor.ui.imageMask.leftToRight"},{value:'right',label:"clientUIAnimationEditor.ui.controls.image.fillRightToLeft"}]});
    else if (values.fillType === 'vertical') result.push({...find('fillVerticalType','clientUIAnimationEditor.ui.imageMask.direction'), options:[{value:'top',label:"clientUIAnimationEditor.ui.controls.image.fillTopToBottom"},{value:'bottom',label:"clientUIAnimationEditor.ui.imageMask.bottomToTop"}]});
    else if (values.fillType === 'radial90') result.push(find('fillRadial90Type','clientUIAnimationEditor.ui.imageMask.startPosition'));
    else if (['radial180','radial360'].includes(String(values.fillType))) result.push(find('fillRadialType','clientUIAnimationEditor.ui.imageMask.startPosition'));
    if (String(values.fillType).startsWith('radial')) result.push(find('fillClockwise'));
    result.push(find('fillAmount','clientUIAnimationEditor.ui.imageMask.progress'));
  }
  result.push(find('reverseMaskArea','clientUIAnimationEditor.ui.imageMask.invertMaskArea'));
  return result;
}
