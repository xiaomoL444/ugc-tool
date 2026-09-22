import type { ControlPropertyField } from './controlRegistry';

/** Presentation only: hidden values remain in the project and animation tracks. */
export function imageMaskFields(fields: ControlPropertyField[], values: Record<string, unknown>): ControlPropertyField[] {
  const find = (key: string, label?: string) => {
    const field = fields.find(item => item.key === key)!;
    return label ? { ...field, label } : field;
  };
  const result = [find('enableMask', '开启遮罩')];
  if (!values.enableMask) return result;
  result.push(find('enableSoftEdge', '边缘羽化'));
  if (values.enableSoftEdge) {
    result.push({ ...find('softEdgeMode'), options: [{value:'pixel',label:'像素'}, {value:'percentage',label:'百分比'}] });
    if (values.softEdgeMode !== 'percentage') result.push(find('softEdgeWidthX', '羽化边缘宽度 X'), find('softEdgeWidthY', '羽化边缘宽度 Y'));
    if (values.softEdgeMode === 'percentage') result.push(find('horizontalSoftRange', '横向区域范围'), find('verticalSoftRange', '纵向区域范围'));
  }
  result.push({key:'__fillEnabled',label:'按进度填充',kind:'boolean'});
  if (values.fillType && values.fillType !== 'unused') {
    result.push({...find('fillType', '形状'), options: find('fillType').options?.filter(item => item.value !== 'unused')});
    if (values.fillType === 'horizontal') result.push({...find('fillHorizontalType','方向'), options:[{value:'left',label:'从左至右'},{value:'right',label:'从右至左'}]});
    else if (values.fillType === 'vertical') result.push({...find('fillVerticalType','方向'), options:[{value:'top',label:'从上至下'},{value:'bottom',label:'从下至上'}]});
    else if (values.fillType === 'radial90') result.push(find('fillRadial90Type','起始位置'));
    else if (['radial180','radial360'].includes(String(values.fillType))) result.push(find('fillRadialType','起始位置'));
    result.push(find('fillAmount','进度'));
  }
  result.push(find('reverseMaskArea','遮罩区域反转'));
  return result;
}
