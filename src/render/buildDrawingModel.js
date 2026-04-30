function fieldValue(value) {
  if (value && typeof value === 'object' && 'value' in value) return value.value;
  return value;
}

function templateFamily(template) {
  return fieldValue(template.familyDisplayName ?? template.family ?? template.familyId ?? template.familyHint);
}

function divisionCount(project, family) {
  return Number(project.options?.doorCount ?? project.options?.panelCount ?? project.options?.slidingPanelCount ?? project.options?.flapCount ?? (family === '슬라이징장' ? 2 : 1));
}

function hingeSide(index, divisions) {
  if (divisions <= 1) return 'right';
  return index % 2 === 0 ? 'left' : 'right';
}

function buildHingeMarkers(components, family, divisions) {
  if (family === '슬라이징장') return [];
  return components
    .filter((component) => component.kind === 'door' || component.kind === 'flap')
    .flatMap((component, index) => {
      if (component.kind === 'flap' || family === '플랩장') {
        return [0.28, 0.72].map((ratio, hingeIndex) => ({
          id: `${component.id}-hinge-${hingeIndex + 1}`,
          componentId: component.id,
          kind: 'hinge-position',
          side: 'top',
          x: component.x + component.width * ratio,
          y: component.y,
          sourceKind: 'user_labeled_reference',
          reviewStatus: 'needs_review',
          note: '플랩장은 상부 경첩 기준의 상향 개폐로 표시합니다. DWG entity 직접 추출값은 아닙니다.',
        }));
      }
      const side = hingeSide(index, divisions);
      const x = side === 'left' ? component.x : component.x + component.width;
      return [0.28, 0.72].map((ratio, hingeIndex) => ({
        id: `${component.id}-hinge-${hingeIndex + 1}`,
        componentId: component.id,
        kind: 'hinge-position',
        side,
        x,
        y: component.y + component.height * ratio,
        sourceKind: 'user_labeled_reference',
        reviewStatus: 'needs_review',
        note: 'KakaoTalk reference image identifies the side marks as hinge positions.',
      }));
    });
}

function openingLine(id, component, x1, y1, x2, y2, lineStyle, hinge) {
  return {
    id,
    componentId: component.id,
    kind: 'door-opening-direction',
    lineStyle,
    hinge,
    x1,
    y1,
    x2,
    y2,
    sourceKind: 'user_labeled_reference',
    reviewStatus: 'needs_review',
    mechanicallyCertain: false,
    note: '샘플 PNG/KakaoTalk reference 기준: 점선/사선은 문 열림 방향 표기입니다. DWG entity 직접 추출값은 아닙니다.',
  };
}

function buildDoorOpeningLines(components, family, divisions) {
  if (family === '슬라이징장') return [];
  return components
    .filter((component) => component.kind === 'door' || component.kind === 'flap')
    .flatMap((component, index) => {
      if (component.kind === 'flap' || family === '플랩장') {
        const centerX = component.x + component.width / 2;
        return [
          openingLine(`${component.id}-opening-center`, component, centerX, component.y + component.height * 0.82, centerX, component.y + component.height * 0.12, 'dashed', 'top'),
          openingLine(`${component.id}-opening-left`, component, centerX, component.y + component.height * 0.82, component.x + component.width * 0.2, component.y + component.height * 0.18, 'solid', 'top'),
          openingLine(`${component.id}-opening-right`, component, centerX, component.y + component.height * 0.82, component.x + component.width * 0.8, component.y + component.height * 0.18, 'solid', 'top'),
        ];
      }
      const side = hingeSide(index, divisions);
      const hingeX = side === 'left' ? component.x : component.x + component.width;
      const targetX = side === 'left' ? component.x + component.width : component.x;
      const hingeY = component.y + component.height / 2;
      return [
        openingLine(`${component.id}-opening-top`, component, hingeX, hingeY, targetX, component.y, 'solid', side),
        openingLine(`${component.id}-opening-bottom`, component, hingeX, hingeY, targetX, component.y + component.height, 'dashed', side),
      ];
    });
}

export function buildDrawingModel(project, template) {
  const dimensions = {
    width: Number(project.dimensions?.width ?? 0),
    height: Number(project.dimensions?.height ?? 0),
    depth: Number(project.dimensions?.depth ?? 0),
  };
  const scale = dimensions.width > 0 && dimensions.height > 0 ? Math.min(480 / dimensions.width, 260 / dimensions.height) : 1;
  const family = templateFamily(template);
  const divisions = Math.max(1, divisionCount(project, family));
  const frontWidth = Math.max(1, dimensions.width);
  const frontHeight = Math.max(1, dimensions.height);
  const components = [{ id: 'cabinet-body', kind: 'body', x: 0, y: 0, width: frontWidth, height: frontHeight }];

  const panelKind = family === '슬라이징장' ? 'sliding-panel' : family === '플랩장' ? 'flap' : 'door';
  for (let index = 0; index < divisions; index += 1) {
    components.push({
      id: `${panelKind}-${index + 1}`,
      kind: panelKind,
      x: (frontWidth / divisions) * index,
      y: 0,
      width: frontWidth / divisions,
      height: frontHeight,
    });
  }
  if (project.options?.mountType === 'legged' || project.options?.install === 'legs') {
    components.push({ id: 'left-leg', kind: 'leg', x: frontWidth * 0.08, y: frontHeight, width: 40, height: 80 });
    components.push({ id: 'right-leg', kind: 'leg', x: frontWidth * 0.86, y: frontHeight, width: 40, height: 80 });
  }
  const hingeMarkers = buildHingeMarkers(components, family, divisions);
  const doorOpeningLines = buildDoorOpeningLines(components, family, divisions);

  return {
    schemaVersion: 1,
    consultationGradeOnly: true,
    productionCadReady: false,
    family,
    familyDisplayName: family,
    templateId: project.templateId ?? template.templateId ?? template.id,
    dimensions,
    viewport: { width: 640, height: Math.max(360, Math.round(frontHeight * scale) + 140), scale },
    body: { x: 40, y: 30, width: Math.round(frontWidth * scale), height: Math.round(frontHeight * scale) },
    components,
    hingeMarkers,
    doorOpeningLines,
    divisions,
    sliding: {
      state: family === '슬라이징장' ? 'required' : 'unavailable',
      shown: family === '슬라이징장',
      reason: family === '슬라이징장' ? '슬라이징장 초안 규칙상 슬라이딩 필수' : '초안 규칙상 슬라이딩 미사용',
    },
    dimensionTable: [
      { label: 'W', value: dimensions.width, unit: 'mm', reviewStatus: 'needs_review' },
      { label: 'H', value: dimensions.height, unit: 'mm', reviewStatus: 'needs_review' },
      { label: 'D', value: dimensions.depth, unit: 'mm', reviewStatus: 'needs_review' },
      { label: '경첩 위치', value: hingeMarkers.length ? `${hingeMarkers.length}개 표시` : '해당 없음', unit: '', reviewStatus: 'needs_review' },
      { label: '문 열림 방향', value: doorOpeningLines.length ? `${doorOpeningLines.length}개 점선/사선 표시` : '해당 없음', unit: '', reviewStatus: 'needs_review' },
    ],
  };
}

export default buildDrawingModel;
