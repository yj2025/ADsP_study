# 공개 배포 준비: 도메인과 VPS

소규모 운영 기준 추천 조합은 Porkbun 일반 .com 도메인과 AWS Lightsail 서울 리전 Linux 1GB 플랜(공인 IPv4 포함)입니다. 앞서 확인한 가격 기준 도메인은 연 약 $11.81, 서버는 월 $7로 합계 연 약 $96입니다. 2GB 플랜은 월 $12입니다. 결제 전 등록가·갱신가와 서버 요금을 확인하세요. 세금, 환율, 유료 스냅샷 및 메일 비용은 별도입니다.

- [Porkbun 도메인 요금](https://porkbun.com/products/domains)
- [Lightsail 요금](https://aws.amazon.com/lightsail/pricing/)

1. Porkbun에서 원하는 일반 .com 도메인을 1년 등록합니다. study.example.com을 쓰려면 example.com을 구매합니다.
2. Lightsail 콘솔에서 서울 → Linux/Unix → OS Only → Ubuntu 24.04 LTS를 선택합니다. 공인 IPv4 포함 1GB 플랜과 SSH 키를 지정해 인스턴스를 생성합니다.
3. Networking에서 고정 IPv4를 생성하고 인스턴스에 연결합니다. TCP 80·443을 공개하고 SSH 22는 가능하면 본인 공인 IP로 제한합니다. 앱 포트 4173은 Compose 내부에서 사용합니다. [고정 IP 연결](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html)
4. Porkbun의 Domain Management → Details → DNS Records → Add Record에서 A 레코드를 추가합니다. Host는 study(루트 도메인은 빈칸), Value는 Lightsail 고정 IPv4, TTL은 기본값입니다. [Porkbun DNS 안내](https://kb.porkbun.com/article/231-how-to-add-dns-records-on-porkbun)
5. PowerShell에서 `Resolve-DnsName study.example.com -Type A`를 실행해 결과가 고정 IPv4와 일치하는지 확인합니다.
6. 서버에 Docker와 Compose를 설치하고, 서버 .env의 SITE_HOST에 실제 도메인을 지정합니다. 기존 SQLite 백업을 새 영구 볼륨에 복구한 뒤 Compose를 시작합니다. HTTPS 접속, 로그인, 재시작 후 학습 기록 유지 및 백업 복구를 확인합니다. [배포·복구 절차](DEPLOY.md)

도메인과 서버를 준비하기 전에는 [로컬 HTTPS 절차](DEPLOY.md#로컬-https)로 테스트합니다.
