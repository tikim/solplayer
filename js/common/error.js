
var SBPError = {

    success : "success",
    param : "wrong parameter or usage",                     // 잘못된 사용 혹은 파라미터
    support : "not supported parameter",                    // 지원되지 않는 명령, 옵션
    implement : "not implemented format or codec",          // 지원되지 않는 포맷 혹은 코덱
    condition : "function called at illegal situation",     // 잘못된 상태에서 내려진 명령
    unknownData : "unknown data format",                    // 알 수 없는 포맷
    noData : "validate data isn't exist",                   // 유효한 데이터가 존재하지 않는 경우
    dataBroken : "data may be broken",                      // 깨진 데이터
    muxOverflow : "muxing buffer overflow",                 // 머싱 버퍼 오버 플로우
    wrongRoutine : "current routine must not be called",    // 현재 실행 코드는 호출되지 않아야 함. 코드 루틴 오류
    wait : "not ready to proceed",                          // 아직 다음 작업을 수행할 단계가 아닌 경우, 추후 발생할 resume 이벤트를 기다려야 한다.
    get : "couldn't get data from server",                  // 서버로 부터 데이터를 받지 못한 경우
    avConfig : "AV Configuration Information wasn't set",   // A/V 트랙의 정보가 설정되어 있지 않아(찾을 수 없어) A/V 데이터를 핸들링할 수 없는 경우

    sbCreate : "couldn't create MSE source buffer",         // MSE SourceBuffer를 생성하지 못한 경우 (브라우저 미지원).
};
