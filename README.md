# 헬창 판독기

20문항 퀴즈로 나의 헬스 스타일을 10가지 유형 중 하나로 알아보는 모바일 웹앱입니다.

## 0) 프로젝트 생성 / 실행

### 프로젝트를 새로 만들 때 (참고)

이 프로젝트는 이미 Next.js로 생성된 상태입니다. 다른 폴더에 새로 만들려면:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
```

### 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 으로 접속합니다.

---

## 폴더/파일 구조

```
health/
├── app/
│   ├── layout.tsx       # 루트 레이아웃, 메타데이터
│   ├── page.tsx         # 홈 (/)
│   ├── globals.css      # 전역 스타일
│   ├── test/
│   │   └── page.tsx     # 퀴즈 화면 (/test)
│   └── result/
│       └── page.tsx     # 결과 화면 (/result)
├── components/
│   ├── ProgressBar.tsx  # 상단 진행바
│   ├── QuestionCard.tsx # 질문 카드
│   ├── AnswerButtons.tsx# 답변 3버튼
│   └── ResultCard.tsx   # 결과 카드
├── lib/
│   ├── types.ts         # 전역 타입
│   ├── questions.ts     # 질문 20개
│   ├── scoring.ts       # 점수·태그·결과 매핑
│   ├── results.ts       # 결과 10종 콘텐츠
│   └── storage.ts       # localStorage 유틸
├── package.json
├── next.config.ts
└── tsconfig.json
```

---

## 기술 스택

- **Next.js 14+** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **localStorage** (답변 저장, 서버 전송 없음)
- 배포: **Vercel** 기준

---

## Vercel 배포 요약

1. **저장소 연동**  
   - GitHub에 프로젝트 푸시 후 [Vercel](https://vercel.com) 로그인 → **Add New Project** → **Import** Git Repository 선택.

2. **설정**  
   - Framework Preset: **Next.js** (자동 감지)  
   - Root Directory: `./` (기본값)  
   - Build Command: `npm run build` (기본값)  
   - Output Directory: `.next` (기본값)

3. **주의점**  
   - 환경 변수 없이 동작하도록 구성되어 있음.  
   - `localStorage`는 사용자 브라우저에만 저장되므로, 배포 환경에서도 서버 전송 없이 동일하게 동작합니다.  
   - 시크릿/프라이빗 브라우징에서는 저장이 안 될 수 있습니다.

4. **배포 후**  
   - 제공되는 URL로 접속해 홈 → 테스트 → 결과 흐름을 한 번 확인하면 됩니다.

---

## 테스트 시나리오 5개

아래 시나리오대로 처음부터 끝까지 진행하면 주요 기능을 검증할 수 있습니다.

### 시나리오 1: 정상 플로우 (전부 “그렇다”에 가깝게)

1. 홈(`/`) 접속 → “시작하기” 클릭  
2. `/test`에서 1~20번까지 **그렇다** 위주로 답변 (일부는 중간/아니어도 됨)  
3. 20번 답변 후 자동으로 `/result` 이동  
4. 결과 카드에서 **중증 헬창(SS급)** 또는 **상급 헬창(S급)** 등 고득점 유형 확인  
5. “내 결과 공유하기” → Web Share 또는 클립보드 복사 동작 확인  
6. “다시하기” 클릭 → 홈으로 이동, localStorage 초기화 후 재진입 시 1번부터 다시 시작되는지 확인  

### 시나리오 2: 이전 문항 / 뒤로가기

1. `/test`에서 5번째 질문까지 답한 뒤 **“이전 문항”** 클릭  
2. 4번 질문으로 돌아가고, 기존 답변이 유지되는지 확인  
3. “← 홈” 클릭 시 홈으로 이동, 다시 “시작하기” 시 저장된 답변부터 이어지는지 확인  

### 시나리오 3: 새로고침 시 복구

1. `/test`에서 10번째 질문까지 답한 뒤 **브라우저 새로고침**  
2. 10번째 질문(또는 마지막으로 답한 다음 문항)부터 이어지는지 확인  
3. 진행바와 답변 상태가 맞는지 확인  

### 시나리오 4: 저득점 → “건강 현실파”

1. 홈에서 시작 → 테스트 진행  
2. 가능한 한 **아니다 / 중간이다** 위주로 답변 (총점 29 이하 또는 상위 조건 미충족)  
3. 결과에서 **“건강 현실파”** 또는 **“귀여운 헬린이”** 등이 나오는지 확인  
4. 결과 카드 하단 “왜 이 결과가 나왔는지”에서 **총점**과 **상위 태그**가 표시되는지 확인  

### 시나리오 5: 직접 결과 URL 접근

1. 브라우저에서 `/result` 또는 `/result?r=reality` 직접 접속  
2. 저장된 답변이 있으면 그에 따른 결과, 없으면 기본(건강 현실파 등)으로 표시되는지 확인  
3. “다시하기” 후 홈으로 이동하는지 확인  

---

## 로컬 실행 확인

```bash
npm run build
npm run start
```

`npm run build`가 성공하고, `npm run start` 후 브라우저에서 동일하게 동작하면 로컬 실행이 정상입니다.
