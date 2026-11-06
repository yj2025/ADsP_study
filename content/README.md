# 콘텐츠 DB와 파일 가져오기

과목·단원·개념·문제는 `data/study.sqlite`의 `content_subjects`, `content_units`, `content_lessons`, `content_questions` 테이블에 저장합니다. 서버의 `GET /api/content`가 학습 화면에 전체 구조와 콘텐츠를 제공합니다. 로그인 없이도 학습 콘텐츠 조회가 가능합니다. 가져오기는 서버 운영자가 로컬 CLI에서 수행하며, 일반 회원에게 콘텐츠 DB 쓰기 권한을 주지 않습니다.

관리자 계정은 웹의 **콘텐츠 관리** 화면에서도 CSV·JSON을 업로드하고 대상 단원을 지정해 검증 후 저장할 수 있습니다. 화면의 지원 범위와 권한 지정 방법은 [관리자 가이드](../docs/ADMIN.md)를 참고하세요. 새 과목·단원 정의 자체는 아래 CLI를 사용합니다.

서버를 처음 실행하면 기존 개념 3개와 문제 6개를 `seed.json`에서 한 번 이전합니다. 다음 실행부터는 DB 내용을 사용하고 기존 콘텐츠를 덮어쓰지 않습니다. 사용자·세션·학습 기록 테이블은 그대로 유지합니다. `seed.json`은 가져오기용이 아닌 최초 이전용입니다.

## 사용법

프로젝트 폴더 `C:\ADsP_study\adsp-study`에서 실행합니다.

```powershell
# 먼저 검증만 수행 (대상 DB를 생성하거나 변경하지 않음)
node scripts/import-content.cjs content/example.json --dry-run

# JSON: 개념 1개와 연결된 문제 1개 추가
node scripts/import-content.cjs content/example.json

# CSV: 다른 개념 1개와 문제 1개 추가
node scripts/import-content.cjs content/example.csv

# 다른 DB를 지정해 연습
node scripts/import-content.cjs content/example.json --database data/practice.sqlite
```

성공하면 `{"lessons":1,"questions":1,"dryRun":false}`가 출력됩니다. CLI로 가져온 개념과 문제도 초안입니다. [관리자 화면](../docs/ADMIN.md)에서 검수 후 공개하면 학습 화면에 반영됩니다. 학습 콘텐츠가 늘어나면 전체 학습량이 늘어 진도율이 내려갈 수 있지만, 이미 완료한 개념·답안·오답 기록은 유지됩니다.

예제는 자체 작성한 예상 학습 콘텐츠이며, 기본 DB에 자동 추가하지 않습니다. `unit_id`를 생략한 기존 파일의 개념은 ‘데이터 이해 / 데이터와 정보’ 단원에 추가됩니다. 문제는 연결한 개념의 단원에 자동으로 소속됩니다.

## 과목과 단원 지정

화면 상단의 과목·단원 선택 또는 대시보드 단원 카드로 학습 범위를 선택합니다. 개념·문제·오답·진도는 선택한 단원만 표시되며 다른 단원의 기록은 유지됩니다. 마지막 선택과 단원별 학습 위치는 게스트는 브라우저에, 회원은 계정에 저장됩니다. ‘선택 단원 기록 초기화’도 해당 단원의 기록만 초기화합니다.

기본 과목과 단원은 다음과 같습니다. 아직 자료가 없는 단원은 ‘준비 중’으로 표시합니다. 단원명은 앱의 초기 학습 분류이며, 전체 출제 기준을 모두 수록한 목록은 아닙니다.

| 과목 ID | 단원 ID | 단원명 |
|---|---|---|
| `data-understanding` | `data-information` | 데이터와 정보 (기존 콘텐츠) |
| `data-understanding` | `database-basics` | 데이터베이스 기초 |
| `analysis-planning` | `planning-basics` | 분석 기획의 이해 |
| `data-analysis` | `statistics-basics` | 통계 분석 기초 |

JSON에서는 기존 배열에 `subjects`, `units` 배열을 선택적으로 추가할 수 있습니다. 새 단원과 콘텐츠를 한 파일에 넣거나 이미 등록된 단원에 개념을 추가할 수 있습니다.

```json
{
  "units": [{"id":"new-planning-unit","subject_id":"analysis-planning","title":"새 분석 기획 단원"}],
  "lessons": [{"id":"new-planning-concept","unit_id":"new-planning-unit","title":"개념 제목","body":"개념 설명"}],
  "questions": [{"id":"new-planning-question","lesson_id":"new-planning-concept","text":"문제 내용","options":["A","B","C","D"],"answer":0,"explanation":"해설"}]
}
```

새 과목은 `"subjects":[{"id":"new-subject","title":"새 과목"}]`으로 추가합니다. 잘못된 `subject_id`, `unit_id`, `lesson_id`는 검증 단계에서 거부됩니다. ID는 각 종류 안에서 고유해야 합니다. 기존 과목·단원을 파일에 반복해서 선언하지 말고, 그 ID를 참조하세요.

실행 가능한 예제는 `subject-example.json`, `subject-example.csv`입니다. 아래 명령은 실제 저장 없이 검사합니다.

```powershell
node scripts/import-content.cjs content/subject-example.json --dry-run
node scripts/import-content.cjs content/subject-example.csv --dry-run
```

CSV는 `type=subject` 행에 `id,title`, `type=unit` 행에 `id,title,subject_id`, `type=lesson` 행에 선택적 `unit_id`를 사용합니다. `type=question` 행은 기존처럼 `lesson_id`를 사용합니다. 정답 번호 규칙은 기존과 동일합니다.

## JSON 형식

최상위 객체에 `subjects`, `units`, `lessons`, `questions` 배열 중 필요한 배열을 넣습니다. 아래 예시처럼 신규 개념과 그 개념을 참조하는 문제를 같은 파일에 넣을 수 있습니다. 기존 개념에 문제만 추가할 수도 있습니다.

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
type,id,title,body,subject_id,unit_id,lesson_id,text,option1,option2,option3,option4,answer,explanation,source_url,license
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
- 파일 크기는 최대 2MB, 한 파일의 과목·단원·개념·문제 합계는 최대 1,000개입니다.
- 잘못된 행이 하나라도 있으면 전체 가져오기를 취소합니다. SQL 트랜잭션으로 중간 저장을 방지합니다.
- 가져온 문자열은 화면에서 HTML로 실행되지 않습니다. 출처와 이용 조건도 DB에 함께 보관합니다.
- 기존 숫자 인덱스 기반 진도를 계속 읽을 수 있습니다. 새로 저장하는 기록에는 개념·문제 ID도 포함합니다.

콘텐츠를 수정해야 한다면 새로운 ID로 별도 항목을 추가하세요. 같은 ID의 문제 정답을 바꾸면 과거 답안의 의미가 달라지므로 이 가져오기 기능에서는 허용하지 않습니다.
