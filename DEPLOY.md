# GitHub + Vercel 연동 방법

로컬에서 이미 **git init**과 **첫 커밋**까지 완료된 상태입니다. 아래 순서대로 진행하면 됩니다.

---

## 1. GitHub에 저장소 만들기

1. [GitHub](https://github.com) 로그인
2. 오른쪽 상단 **+** → **New repository**
3. **Repository name**: 예) `health` 또는 `helchang-reader`
4. **Public** 선택
5. **"Add a README file"** 등은 체크하지 말고, **Create repository**만 클릭  
   (이미 로컬에 코드가 있으므로)

---

## 2. 로컬을 GitHub에 푸시

GitHub에서 저장소를 만든 뒤, 아래에서 **본인 아이디**와 **저장소 이름**만 바꿔서 실행하세요.

```powershell
cd c:\Users\wnstn\health

# 원격 저장소 연결 (USERNAME과 REPO를 본인 것으로 변경)
git remote add origin https://github.com/USERNAME/REPO.git

# 기본 브랜치 이름을 main으로 맞추기 (선택)
git branch -M main

# 푸시
git push -u origin main
```

예: 아이디가 `wnstn`이고 저장소 이름이 `health`라면  
`git remote add origin https://github.com/wnstn/health.git`

- **처음 푸시 시** GitHub 로그인 창이 뜨거나, 인증 실패 시 **Personal Access Token**으로 비밀번호 대신 입력해야 할 수 있습니다.  
  토큰 생성: GitHub → Settings → Developer settings → Personal access tokens → Generate new token (repo 권한 체크)

---

## 3. Vercel에 연동

1. [Vercel](https://vercel.com) 로그인 (GitHub 계정으로 로그인 권장)
2. **Add New...** → **Project**
3. **Import Git Repository**에서 방금 푸시한 **health** (또는 만든 저장소 이름) 선택
4. **Import** 클릭
5. 설정은 기본값 그대로 두고 **Deploy** 클릭  
   - Framework: Next.js 자동 감지  
   - Build Command: `npm run build`  
   - Output: `.next`
6. 배포가 끝나면 **Visit**로 배포된 URL 확인

이후에는 **GitHub에 push할 때마다** Vercel이 자동으로 다시 배포합니다.

---

## Git 사용자 정보 (선택)

커밋 작성자 이름/이메일을 본인 것으로 바꾸려면:

```powershell
git config --global user.name "본인이름"
git config --global user.email "github에 등록한 이메일"
```

이미 커밋은 되어 있으므로, 다음 커밋부터 적용됩니다.
