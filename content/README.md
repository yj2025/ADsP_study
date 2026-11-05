# 콘텐츠 DB와 파일 가져오기

개념과 문제는 `data/study.sqlite`의 `content_lessons`, `content_questions` 테이블에 저장합니다. 서버의 `GET /api/content`가 학습 화면에 콘텐츠를 제공합니다. 로그인 없이도 학습 콘텐츠 조회가 가능합니다. 가져오기는 서버 운영자가 로컬 CLI에서 수행하며, 일반 회원에게 콘텐츠 DB 쓰기 권한을 주지 않습니다.

서버를 처음 실행하면 기존 개념 3개와 문제 6개를 `seed.json`에서 한 번 이전합니다. 다음 실행부터는 DB 내용을 사용하고 기존 콘텐츠를 덮어쓰지 않습니다. 사용자·세션·학습 기록 테이블은 그대로 유지합니다. `seed.json`은 가져오기용이 아닌 최초 이전용입니다.

## 사용법

프로젝트 폴더 `C:\ADsP_study\adsp-study`에서 실행합니다.

```powershell
# 먼저 검증만 수행 (대상 DB를 생성하거나 변경하지 않음)
node import-content.cjs content/example.json --dry-run

# JSON: 개념 1개와 연결된 문제 1개 추가
node import-content.cjs content/example.json

# CSV: 다른 개념 1개와 문제 1개 추가
node import-content.cjs content/example.csv

# 다른 DB를 지정해 연습
node import-content.cjs content/example.json --database data/practice.sqlite
```

성공하면 `{"lessons":1,"questions":1,"dryRun":false}`가 출력됩니다. 서버는 DB를 매 요청마다 조회하므로 가져온 후 학습 페이지를 새로고침하면 목록과 진도가 반영됩니다. 서버 재시작은 필요하지 않습니다. 학습 콘텐츠가 늘어나면 전체 학습량이 늘어 진도율이 내려갈 수 있지만, 이미 완료한 개념·답안·오답 기록은 유지됩니다.

예제는 자체 작성한 예상 학습 콘텐츠이며, 기본 DB에 자동 추가하지 않습니다. 현재 앱의 단일 학습 목록에 추가됩니다.

## JSON 형식

최상위 객체에 `lessons`, `questions` 배열을 넣습니다. 둘 중 하나만 넣어도 됩니다. 아래 예시처럼 신규 개념과 그 개념을 참조하는 문제를 같은 파일에 넣을 수 있습니다. 기존 개념에 문제만 추가할 수도 있습니다.

```json
{
  "lessons": [
    {"id":"my-lesson","title":"개념 제목","body":"본문 첫 줄\n본문 둘째 줄","source_url":"","license":"자체 작성"}
  ],
  "questions": [
    {"id":"my-question","lesson_id":"my-lesson","text":"문제 내용","options":["보기 A","보기 B","보기 C","보기 D"],"answer":0,"explanation":"정답과 오답을 구분하는 해설","source_url":"","license":"자체 작성"}
  ]
}
```

JSON의 `answer`는 **0~3의 정수**입니다. `0`이 첫 번째 보기입니다. `body`는 일반 텍스트이며 HTML이나 Markdown을 해석하지 않습니다. 줄바꿈은 화면에 유지됩니다. 기존 개념의 표 등 풍부한 HTML은 최초 이전 과정에서만 유지합니다.

## CSV 형식

UTF-8로 저장합니다. Excel의 **CSV UTF-8(쉼표로 분리)** 형식을 사용할 수 있으며 BOM도 허용합니다. 헤더 이름은 아래와 같습니다. 파일에는 필요한 열만 넣어도 되지만 각 행에 필요한 필드는 반드시 있어야 합니다.

```csv
type,id,title,body,lesson_id,text,option1,option2,option3,option4,answer,explanation,source_url,license
```

| 열 | 개념 행 (`type=lesson`) | 문제 행 (`type=question`) |
|---|---|---|
| `id` | 필수, 고유 개념 ID | 필수, 고유 문제 ID |
| `title`, `body` | 필수 | 비워 둠 |
| `lesson_id` | 비워 둠 | 필수, 연결할 개념 ID |
| `text` | 비워 둠 | 필수, 문제 내용 |
| `option1`~`option4` | 비워 둠 | 모두 필수, 서로 다른 보기 |
| `answer` | 비워 둠 | **1~4**의 보기 번호 |
| `explanation` | 비워 둠 | 필수 |
| `source_url`, `license` | 선택 | 선택 |

CSV에서는 작성 편의를 위해 **1번 보기가 `answer=1`**입니다. JSON의 0 기반 인덱스와 다릅니다. 쉼표·줄바꿈이 있는 셀은 큰따옴표로 감싸고, 셀 내부의 큰따옴표는 `""`로 씁니다. `example.csv`에서 실제 형식을 확인할 수 있습니다.

## 검증 및 기록 보존

- ID는 영문자로 시작하고 영문·숫자·하이픈·밑줄로 구성한 64자 이내 문자열입니다.
- 개념 ID와 문제 ID는 각각 고유해야 합니다. 같은 파일을 두 번 가져오면 중복 오류가 납니다.
- 추가만 지원합니다. 기존 항목 덮어쓰기·삭제·재정렬을 제공하지 않아 기존 학습 기록의 의미를 유지합니다.
- 문제는 DB 또는 같은 파일에 있는 개념을 참조해야 합니다. 보기는 정확히 4개이며 모두 달라야 합니다.
- 파일 크기는 최대 2MB, 한 파일의 개념과 문제 합계는 최대 1,000개입니다.
- 잘못된 행이 하나라도 있으면 전체 가져오기를 취소합니다. SQL 트랜잭션으로 중간 저장을 방지합니다.
- 가져온 문자열은 화면에서 HTML로 실행되지 않습니다. 출처와 이용 조건도 DB에 함께 보관합니다.
- 기존 숫자 인덱스 기반 진도를 계속 읽을 수 있습니다. 새로 저장하는 기록에는 개념·문제 ID도 포함합니다.

콘텐츠를 수정해야 한다면 새로운 ID로 별도 항목을 추가하세요. 같은 ID의 문제 정답을 바꾸면 과거 답안의 의미가 달라지므로 이 가져오기 기능에서는 허용하지 않습니다.
