import { REVIEW_STATUS, SOURCE_KIND } from '../../shared/review-status.js';

const dimension = (min, max, step, defaultValue) => ({
  min,
  max,
  step,
  defaultValue,
  unit: 'mm',
  sourceKind: SOURCE_KIND.COMMON_LOGIC,
  reviewStatus: REVIEW_STATUS.NEEDS_REVIEW,
});

const option = (value, label, enabled = true, disabledReason = '') => ({ value, label, enabled, disabledReason });

export const trackADraftTemplates = [
  {
    id: 'track-a-base-cabinet',
    track: 'A',
    family: '하부장',
    displayName: '하부장 상담용 초안',
    consultationGradeOnly: true,
    dwgAutomationRequired: false,
    reviewStatus: REVIEW_STATUS.NEEDS_REVIEW,
    dimensions: { width: dimension(300, 2400, 50, 800), height: dimension(600, 900, 10, 720), depth: dimension(450, 700, 10, 580) },
    options: { doorCount: [option(1, '1도어'), option(2, '2도어'), option(3, '3도어'), option(4, '4도어')], install: [option('legs', '다리'), option('wall', '벽걸이')] },
    sliding: { state: 'unavailable', reason: '하부장 초안 규칙에서는 슬라이딩 미사용' },
  },
  {
    id: 'track-a-upper-cabinet',
    track: 'A',
    family: '상부장',
    displayName: '상부장 상담용 초안',
    consultationGradeOnly: true,
    dwgAutomationRequired: false,
    reviewStatus: REVIEW_STATUS.NEEDS_REVIEW,
    dimensions: { width: dimension(300, 1800, 50, 800), height: dimension(300, 900, 10, 700), depth: dimension(250, 450, 10, 350) },
    options: { doorCount: [option(1, '1도어'), option(2, '2도어'), option(3, '3도어')], install: [option('wall', '벽걸이')] },
    sliding: { state: 'unavailable', reason: '상부장 초안 규칙에서는 슬라이딩 미사용' },
  },
  {
    id: 'track-a-sliding-cabinet',
    track: 'A',
    family: '슬라이징장',
    displayName: '슬라이징장 상담용 초안',
    consultationGradeOnly: true,
    dwgAutomationRequired: false,
    reviewStatus: REVIEW_STATUS.NEEDS_REVIEW,
    dimensions: { width: dimension(900, 2400, 50, 1600), height: dimension(1800, 2400, 10, 2100), depth: dimension(450, 700, 10, 600) },
    options: { panelCount: [option(2, '2패널'), option(3, '3패널')], rail: [option('top-bottom', '상하 레일')] },
    sliding: { state: 'required', reason: '슬라이징장 초안 규칙상 슬라이딩 필수' },
  },
  {
    id: 'track-a-three-door',
    track: 'A',
    family: '3도어장',
    displayName: '3도어장 상담용 초안',
    consultationGradeOnly: true,
    dwgAutomationRequired: false,
    reviewStatus: REVIEW_STATUS.NEEDS_REVIEW,
    dimensions: { width: dimension(900, 1800, 50, 1200), height: dimension(600, 2200, 10, 1800), depth: dimension(450, 650, 10, 550) },
    options: { doorCount: [option(3, '3도어')], install: [option('legs', '다리'), option('wall', '벽걸이')] },
    sliding: { state: 'unavailable', reason: '3도어장 초안 규칙에서는 여닫이 기준' },
  },
  {
    id: 'track-a-flap-cabinet',
    track: 'A',
    family: '플랩장',
    displayName: '플랩장 상담용 초안',
    consultationGradeOnly: true,
    dwgAutomationRequired: false,
    reviewStatus: REVIEW_STATUS.NEEDS_REVIEW,
    dimensions: { width: dimension(450, 1800, 50, 900), height: dimension(250, 700, 10, 400), depth: dimension(250, 500, 10, 350) },
    options: { flapCount: [option(1, '1플랩'), option(2, '2플랩')], hinge: [option('up', '상향 플랩')] },
    sliding: { state: 'unavailable', reason: '플랩장 초안 규칙에서는 플랩 도어 기준' },
  },
];

export function getTrackATemplate(templateId = trackADraftTemplates[0].id) {
  return trackADraftTemplates.find((template) => template.id === templateId) ?? trackADraftTemplates[0];
}
