export const TRACKS = Object.freeze({
  A: {
    id: 'track-a',
    name: 'Consultation UI MVP',
    owns: ['src/track-a', 'src/data/templates/track-a-draft-templates.js'],
    mayUseDwgAutomation: false,
    acceptanceGate: 'ui_mvp',
  },
  B: {
    id: 'track-b',
    name: 'DWG-driven template DB preparation',
    owns: ['src/track-b', 'tools/cad-extract', 'data/cad-evidence', 'src/data/templateManifest.json'],
    mayUseDwgAutomation: true,
    acceptanceGate: 'dwg_template_evidence',
  },
});

export function assertTrackAIsIndependent() {
  if (TRACKS.A.mayUseDwgAutomation) {
    throw new Error('Track A must not wait on DWG automation.');
  }
  return true;
}
