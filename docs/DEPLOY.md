# HTTPS 배포와 SQLite 복구

## 로컬 HTTPS

로컬 인증서 `data/tls/local.crt`와 키 `data/tls/local.key`가 있으면 `npm run start:https`로 `https://127.0.0.1:4443`에서 실행합니다. 기존 HTTP 서버와 동일한 SQLite DB를 사용하며 HTTPS에서 발급하는 세션 쿠키에는 `Secure`가 설정됩니다. 인증서가 없다면 OpenSSL로 생성합니다.

```powershell
New-Item -ItemType Directory -Force data/tls | Out-Null
openssl req -x509 -newkey rsa:2048 -sha256 -noenc -days 90 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' -keyout data/tls/local.key -out data/tls/local.crt
npm run start:https
```

자체 서명 인증서이므로 브라우저의 신뢰 목록에 없는 기기에서는 경고가 뜹니다. 운영에는 공인 인증서를 사용합니다. 로컬 연결은 검증을 끄지 않고 `curl --cacert data/tls/local.crt https://127.0.0.1:4443/api/content`로 검사할 수 있습니다.

## 공개 도메인에 배포

Docker와 Compose가 실행되는 호스트에서 도메인 DNS를 호스트로 연결하고 80·443 포트를 열어 둡니다. `.env`에 `SITE_HOST=study.example.com`을 실제 도메인으로 설정합니다. `docker compose up -d --build`로 시작하면 Caddy가 공개 HTTPS와 HTTP 리다이렉트를 담당합니다. [Caddy의 자동 HTTPS 요구사항](https://caddyserver.com/docs/automatic-https#hostname-requirements)을 참고하세요. 앱 포트는 외부에 노출하지 않습니다. 실제 이메일 인증·재설정 메일은 [계정 관리 가이드](ACCOUNT.md)의 웹훅 설정이 필요합니다.

SQLite 파일은 `study_data` 볼륨의 `/data/study.sqlite`에 있습니다. 컨테이너 재생성이나 이미지 업데이트 이후에도 같은 볼륨을 사용합니다. Caddy 인증서와 설정도 별도 볼륨에 유지합니다. `docker compose down -v`는 이 볼륨들을 삭제하므로 일반 중지에는 `docker compose down`을 사용합니다. DB에는 기존 로컬 파일이 자동으로 복사되지 않으므로, 이전할 때에는 최초 서버 실행 전에 검증된 백업을 새 볼륨에 복구합니다.

## 백업과 복구

```powershell
npm run db -- backup
npm run db -- restore data/backups/<백업파일>.sqlite data/restored.sqlite
npm run db -- verify data/restored.sqlite
```

백업 명령은 실행 중인 DB를 SQLite 온라인 백업 API로 복제합니다. WAL에만 들어 있는 커밋도 포함하며, 검사에 통과한 독립 SQLite 파일을 `data/backups/`에 만듭니다. 복구는 새 경로에만 가능하며 대상 파일과 SQLite 보조 파일이 이미 있으면 중단합니다. 무결성 검사와 외래키 검사 후 계정·학습 기록·개념·문제 건수 및 SHA-256을 출력합니다. 복구 시 SQLite 헤더가 달라질 수 있으므로 두 파일의 해시가 같아야 하는 것은 아닙니다.

운영 Compose에서는 `docker compose exec -T app node scripts/database.cjs backup /data/backups/study-YYYYMMDD.sqlite`를 실행하고 `docker compose cp app:/data/backups/study-YYYYMMDD.sqlite ./study-YYYYMMDD.sqlite`로 별도 저장소에 옮깁니다. 백업에는 계정과 세션 정보가 포함되므로 접근 권한을 제한하세요. DB 볼륨 장애에 대비해 복사본을 별도 위치에 보관하고 정기적으로 복구를 시험합니다.

운영 전환 시에는 새 경로에 복구해 검증한 뒤 서버를 중지하고 `DATABASE_PATH`를 복구본으로 지정해 다시 시작합니다. Compose에서 기존 DB를 이전할 경우 새 볼륨을 사용하는 상태에서 백업 파일을 컨테이너의 읽기 전용 경로에 마운트한 후 `node scripts/database.cjs restore /restore/study.sqlite /data/study.sqlite`를 실행합니다. 파일은 컨테이너의 `node` 사용자가 읽을 수 있어야 합니다. 복구 대상이 비어 있지 않으면 기존 파일을 보존하고 새 경로를 선택하세요.
