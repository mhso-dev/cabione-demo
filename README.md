# Cabione 욕실가구 비규격 발주서

`DOCTYPE.txt`의 완성형 화면/상호작용을 현재 프로젝트 앱으로 이식한 정적 웹 앱입니다. 기존 상담용 CAD MVP 화면 대신, 홈 → 모델 선택 → 편집기 → 발주서 미리보기 흐름을 바로 실행합니다.

## 주요 기능

- **모델 정하기 / 직접 그리기** 시작 화면
- 욕실가구 템플릿 6종 선택 및 미리보기
- 가로/세로 치수 입력과 10mm 단위 스냅
- 선반, 가이드바, 1구/2구 콘센트 배치
- 선반 폭 리사이즈, 배치 항목 드래그 이동
- 직접 그리기 모드에서 외곽 크기 핸들 조정
- LED 색온도 선택
- 발주서 미리보기, 텍스트 복사, 인쇄/PDF 저장
- 모바일 패널 토글과 반응형 화면

## DWG 기반 제품군/템플릿 데이터

Track B 데이터 준비 파이프라인은 `samples/*.dwg`를 직접 읽어 제품군 선택에 필요한 도면 정보를 수집합니다.

- 직접 DWG reader: `@node-projects/acad-ts`
- 추출 항목: DWG hash/signature, entity counts, layers, text/MText, dimension entities, bounds, view labels, product-selection signals
- 생성 산출물:
  - `data/cad-evidence/*.json`
  - `data/draft-templates/*.json`
  - `src/data/templates/*.json`
  - `src/data/templateManifest.json`
  - `src/data/trackBTemplateManifest.json`
- 주의: DWG entity 자체에서 읽은 값은 `dwg_entity`로 기록하지만, 폭/높이/깊이 역할 매핑과 제품군 추론은 다중 뷰 해석이 필요하므로 `needs_review`로 유지합니다.

재생성:

```bash
node tools/cad-extract/inspect-dwg-samples.mjs
```

## 구조

```text
index.html                               # 앱 셸과 화면 마크업
src/styles.css                           # DOCTYPE.txt 기반 UI/도면 스타일
src/main.js                              # 템플릿, 상태, SVG 렌더링, 드래그/발주서 로직
src/track-b/direct-dwg-inspection.js     # 직접 DWG entity 추출 로직
src/data/templateManifest.json           # DWG 샘플 기반 런타임 템플릿 manifest
data/cad-evidence/*.json         # DWG 직접 추출 evidence (생성 파일)
DOCTYPE.txt                              # 원본 참고 구현
```

## 실행

정적 파일이므로 별도 빌드 없이 브라우저에서 `index.html`을 열면 됩니다. 로컬 서버로 확인하려면:

```bash
python3 -m http.server 4173
# http://localhost:4173
```

## 검증

```bash
npm run check
npm run lint
npm test
npm run build
```
