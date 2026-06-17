# Make Dangol Landing

Claude로 만든 랜딩페이지 코드를 웹에 올리기 위한 정적 사이트 기본 세팅입니다.

## 파일 구조

- `index.html`: 랜딩페이지 HTML
- `src/styles.css`: 스타일
- `src/main.js`: 필요한 JavaScript
- `netlify.toml`: Netlify 배포 설정
- `vercel.json`: Vercel 배포 설정

## 로컬 확인

브라우저에서 `index.html`을 열어 바로 확인할 수 있습니다.

## Netlify 배포

1. GitHub에 이 저장소를 push합니다.
2. Netlify에서 `Add new site` > `Import an existing project`를 선택합니다.
3. Build command는 비워둡니다.
4. Publish directory는 `.`로 설정합니다.

## Vercel 배포

1. GitHub에 이 저장소를 push합니다.
2. Vercel에서 `Add New Project`로 저장소를 import합니다.
3. Framework Preset은 `Other`를 선택합니다.
4. Build command는 비워두고 Output Directory도 비워둡니다.

## Claude 코드 붙이는 위치

- HTML 전체가 있다면 `index.html` 본문을 교체합니다.
- CSS가 따로 있다면 `src/styles.css`에 붙입니다.
- JavaScript가 있다면 `src/main.js`에 붙입니다.
