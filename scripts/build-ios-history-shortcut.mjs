#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const APP_TEAM_ID = "UV7YN4GQ66";
const APP_BUNDLE_ID = "app.wafra.ios";
const PREPARE_INTENT = `${APP_BUNDLE_ID}.PrepareWafraHistoryMessageIntent`;
const IMPORT_INTENT = `${APP_BUNDLE_ID}.ImportWafraPreparedHistoryIntent`;
const PREPARE_V2_INTENT = `${APP_BUNDLE_ID}.PrepareWafraHistoryMessageV2Intent`;
const PREPARE_V3_INTENT = `${APP_BUNDLE_ID}.PrepareWafraHistoryMessageV3Intent`;
const IMPORT_V2_INTENT = `${APP_BUNDLE_ID}.ImportWafraPreparedHistoryV2Intent`;
const DISCARD_V2_INTENT = `${APP_BUNDLE_ID}.DiscardWafraPreparedHistoryV2Intent`;
const FIND_MESSAGES = "com.apple.MobileSMS.MessageEntity";

const ids = {
  disclosure: "9AF5C01A-2D51-4700-93B9-77A8672921C1",
  now: "81674C8C-BBB9-48C0-A985-3475A084880E",
  todayStart: "E5D29C43-3472-498C-995A-001706B751A1",
  minusThirtyDays: "5E6DF779-7D1D-4DD9-9289-DF0F4F48B3B4",
  startBoundary: "67670854-6EE2-4E36-B8B9-A5496A93AE96",
  tomorrowBase: "23C717CA-B996-4500-9A52-D220D0AEB0F5",
  exclusiveEnd: "A986E730-8163-49ED-9C50-72B027E371B4",
  yearStart: "E5711D85-615B-48A5-BDBE-BE85573CDCEA",
  rangeMenu: "79F30664-BDB8-4719-90FD-36A81E87EA82",
  last30SetStart: "091525FA-7820-43D8-BE92-BA0FD268649D",
  last30SetEnd: "9024D73D-3841-4328-881E-32BED7B317E5",
  yearSetStart: "07858262-ACDB-4FFF-BE77-8B180638A2CB",
  yearSetEnd: "3274EA70-3D80-49C3-9A88-E7CC4750A3DF",
  askCustomStart: "68D1CBD8-C551-427E-ABFF-DB7224DD4260",
  customStartDay: "D841C211-DDF2-46A9-A661-DE1A7FB2434A",
  customSetStart: "EB295639-B249-4D47-ACD6-06D79889BDCA",
  askCustomEnd: "04F05A0F-0E9B-45E7-A1F0-BAD56E277CD0",
  customEndDay: "8277DEBD-5990-496C-AEED-FBD6D282AC0A",
  customExclusiveEnd: "BE5D70D2-89A9-4DDF-B4DB-F64C3E56CA22",
  customSetEnd: "BB48A062-4677-4E80-96B7-E38820605FA5",
  selectedRangeDays: "64832663-32D4-4D99-B10A-D92400D75CF4",
  invalidRangeGroup: "8ED186B9-DC6E-4ED5-A57B-C940972F6C4C",
  invalidRangeAlert: "72E46C1B-A458-4A94-9F6F-5738F7C3C092",
  find: "7C991082-8041-44B4-B8EC-755CA6AEB5E8",
  found: "74716FAF-11D6-45EB-B465-972453EC54D9",
  zeroGroup: "73773447-7494-4196-8320-59257877BBA8",
  zeroAlert: "68B27C29-1FA7-49DE-85B1-8B052BF69BE2",
  tooManyGroup: "59E31E6B-9975-4D77-AF01-75E996F2AE5D",
  tooManyAlert: "348FA64C-7080-49E5-81BB-B4B9DAEEBCB6",
  confirmation: "C156CEEB-7A41-4E19-BF36-50DFA08A0966",
  randomA: "0AAB4B2B-7883-4106-B6E1-D8123C24058C",
  randomB: "1F518018-C55B-4D66-B666-818800D9C7A8",
  sessionId: "51E80925-88B9-466D-AC85-C3EA694948F3",
  repeatGroup: "3CE43506-9329-4241-A8F2-700A422DE928",
  repeatStart: "60FF5006-BC03-4D41-BD5E-69DF764074BE",
  messageGuidText: "C59B9727-92DA-4411-85C1-D75B26C91B2B",
  messageBodyText: "69377A05-6352-48C8-81B0-49A7C293C7D9",
  messageSenderText: "5E0C2ED8-99ED-4D7A-8FC6-44E6BBDCD503",
  prepare: "CF14C33B-725B-4B30-9E0F-91170617BEE3",
  repeatEnd: "6782C0C0-F98C-4E79-9B4D-00349543B958",
  finalImport: "13E8DC28-0D5C-41D0-BA31-8AC111D2BE2E",
  encoded: "43FB9E09-A061-47F6-A8E2-35F2C12C2601",
  url: "9EBA1423-20E3-4ABF-8C62-FEB924817571",
  v2YearEnd: "98FF0116-285B-4CA0-8E89-44D185922E39",
  v2ChosenYear: "AC4EF921-C2A8-4844-93AE-4A0E3781E879",
  v2ChosenYearStart: "8D69BEF7-DA35-416D-BDCE-90FF052A20A4",
  v2ChosenYearEnd: "44319D9B-B702-48F7-AB55-7BA58654A1C6",
  v2Last30Count: "191CDD7A-5B25-4478-9090-0D749BBA443F",
  v2Last30SetCount: "F624AB67-F9FD-4348-BDB8-AF6B9793D635",
  v2YearCount: "EBC8D5DF-46E4-4126-8CF9-BAD3515EF1E8",
  v2YearSetCount: "0AF4D037-2469-40D8-9B19-2C67F2981C27",
  v2ChosenCount: "62541958-0A60-47BC-ABD4-3C883A2191A5",
  v2ChosenSetCount: "26CBEC0D-9C21-4E59-A7EC-3E19CDBA5576",
  v2CursorSet: "9EFF9772-4276-4804-BB84-74BFC5D22FBF",
  v2PositionInitial: "EBA22677-7486-433E-975D-18DB43175111",
  v2PositionSet: "FFBC887D-6C91-4F7F-9C0C-871CCBD31A9B",
  v2OuterGroup: "1625854C-6C8C-420E-B59A-1F563F8E4C67",
  v2OuterStart: "20C33274-7FE9-4735-BBF4-283D7E8E38D0",
  v2OuterEnd: "D6574273-800E-40A6-A445-8CD0BAF61880",
  v2DayEnd: "0E36981F-BA33-45E0-8994-F187CF02FDCB",
  v2OverflowGroup: "D2295245-208A-40F3-A7EA-BA0EBE73EBA2",
  v2DiscardDaily: "E61DD188-6B47-4BC9-81ED-25425AF8D711",
  v2OverflowAlert: "303755A1-77FE-4681-B9FB-72451165856D",
  v2NonzeroGroup: "454EC737-D1A3-4F15-AAB8-176DA25C2366",
  v2InnerGroup: "ED5966BA-5BF9-4619-8A9C-177341BA4722",
  v2InnerStart: "0BC8522C-1E62-4E20-82DE-1C7064171ED6",
  v2InnerEnd: "3127B507-4C63-40B8-B044-C5FE3D3232FA",
  v2Increment: "5ABFC59A-526C-4568-884E-8DBB8989A68E",
  v2IncrementSet: "891FE61B-6204-4B89-92F5-B0DAB2663905",
  v2TotalOverflowGroup: "00647AD8-BE43-4905-9598-5D400DACF00D",
  v2DiscardTotal: "293EFC05-7887-4E55-850A-4C73BBD9DCEA",
  v2TotalOverflowAlert: "3F007C2B-F9E6-4463-A85C-4B3A725A08B7",
  v2Prepare: "D167289E-CCBA-40A6-88D6-1191689C4BB5",
  v2CursorAdvance: "91D7CC86-6EE6-4CAD-AE15-886A24C07F45",
  v2Nothing: "C47DEF94-4042-45C9-9E79-63464946F6D1",
  v2ZeroTotalGroup: "5BEFB4C7-B4C0-4A13-9ADE-04FDCFE0FFD3",
  v2ZeroTotalAlert: "30C8B6D5-6257-492F-BDB3-AC2A5EFD9053",
  v2FinalImport: "A96DF1C6-C4CE-4334-A7A5-D850FD96170A",
  v2RangeStartBoundary: "5EA45DD3-28F2-45BE-9252-AC1FB8D2ABC0",
  v2WindowCount: "3856F702-A638-446C-887A-49BEDA050E9F",
  v2DayDenseGroup: "293C4B7C-5D7E-4784-8BA6-460E87093481",
  v2HourCursorSet: "68986610-B7BE-40BC-8957-A4526E274554",
  v2HourLoopGroup: "E02C03B8-0F3C-4A7B-9EA5-81EDC32EC032",
  v2HourLoopStart: "7A858DBA-73A4-4B13-AA75-2BC6C089517C",
  v2HourStart: "044B4B8F-75F3-41FA-96D5-A18350E3AE8F",
  v2HourBoundary: "D5B9F507-C9D6-4B4A-AB5E-C91151DCB577",
  v2HourFind: "0BEA7BA9-6589-4588-87C2-9CB9E297219E",
  v2HourCount: "2BE82250-B215-4D2B-A2D9-2F8B99CDDB56",
  v2HourDenseGroup: "4583BDBA-17D6-4733-B9ED-2E5715A320F0",
  v2MinuteCursorSet: "37AFC694-6064-4D62-944A-00080803E0FC",
  v2MinuteLoopGroup: "0E29DBCD-0F8B-4E93-95F4-FE4E355D7233",
  v2MinuteLoopStart: "9D46B8AD-9A1D-42A4-8872-39D5CCF54561",
  v2MinuteStart: "0088D8F3-02EA-4F41-8703-02F81FF15D7A",
  v2MinuteBoundary: "D4E9543A-40CA-408B-B86A-CBB3CDD4CC74",
  v2MinuteFind: "7E4718DD-6E6D-41F5-B073-31A5250A4C20",
  v2MinuteCount: "AA2FB9CC-B627-4939-AC74-85D4A6E986DB",
  v2MinuteOverflowGroup: "E603816D-6EDC-40A0-B2BA-BABBA1463FFD",
  v2MinuteOverflowDiscard: "F5A0DFED-2BB3-4B69-8E15-BDB53B01814A",
  v2MinuteOverflowAlert: "58FB3095-30A8-448F-B5D3-3766833C0629",
  v2MinuteCursorAdvance: "8EB96587-6838-4759-92BC-655A612F9D17",
  v2MinuteNothing: "2D9B9453-872F-40F9-ABA3-C4418A9E6189",
  v2MinuteLoopEnd: "2ED04310-942A-40BA-88F4-F98051235715",
  v2HourCursorAdvance: "9E10FB9C-E4CD-46C3-A0A8-1B174C0E6E2F",
  v2HourNothing: "BE9AC87A-28F4-4913-9AAC-3FFF7DFF820D",
  v2HourLoopEnd: "3785B16F-178B-411C-B819-309B8B9392AB",
  v2HourBatchNonzeroGroup: "43DBAD03-58A2-44EF-AF97-BE9CAC5B3B1E",
  v2HourBatchInnerGroup: "740FD976-1DD5-400A-A2CD-84A0A5D653AD",
  v2HourBatchInnerStart: "828F86BA-33EB-413E-9D34-9275F3173444",
  v2HourBatchInnerEnd: "F018C3B9-65CF-4E0F-9A10-1521953F107A",
  v2HourBatchIncrement: "9095532E-8661-450B-81B3-7C18EBEE1571",
  v2HourBatchIncrementSet: "92AEBB4C-DF44-4038-8E20-77174CE1420C",
  v2HourBatchTotalOverflowGroup: "5DB60147-FE43-4A5C-A56E-B4353574ED6B",
  v2HourBatchDiscardTotal: "0E0E7E4E-60B0-4471-A3E3-60C5740468C4",
  v2HourBatchTotalAlert: "B589440A-A8B8-4E13-869D-061B43BA3E06",
  v2HourBatchGuidText: "04AB7C2A-7A4F-4528-8BD7-C01E9E1853D0",
  v2HourBatchBodyText: "FE41294C-1A59-49C4-8ED1-74698CC7F049",
  v2HourBatchSenderText: "49CFD0C3-9CF2-4E05-9F57-EA11018B6027",
  v2HourBatchPrepare: "3E9B617E-C662-4522-ABC5-6BFD22810F7A",
  v2MinuteBatchNonzeroGroup: "34224E67-9859-45B0-BCCA-3981C7C91D08",
  v2MinuteBatchInnerGroup: "4D72D79F-3EE9-4679-83D0-0FECA39AA8FC",
  v2MinuteBatchInnerStart: "E6DE95FE-0547-4A19-9FF9-2D81E8FF8DD2",
  v2MinuteBatchInnerEnd: "988D108B-CE3C-4BBD-A2F9-A86804780817",
  v2MinuteBatchIncrement: "1DFAF3C9-18DE-46FD-9DD4-99824E12A007",
  v2MinuteBatchIncrementSet: "A983EE87-BFFD-475E-9031-4B7805766347",
  v2MinuteBatchTotalOverflowGroup: "27E83143-9A2C-4C0B-870D-CC56B9A33486",
  v2MinuteBatchDiscardTotal: "A0EC4044-FBEA-4AAB-96E2-83B5643F5E49",
  v2MinuteBatchTotalAlert: "41535B09-116F-475E-9016-CC162402EC35",
  v2MinuteBatchGuidText: "49348E19-AB1C-45DB-B283-856E12C0E810",
  v2MinuteBatchBodyText: "1A59389E-70FE-4D67-A818-5DCC591CE44D",
  v2MinuteBatchSenderText: "15CBE43E-C997-41AD-95A2-5AC7F5A50BF0",
  v2MinuteBatchPrepare: "D478F2AA-284B-47A2-8771-BCE344ED78EE",
  v2SecondCursorSet: "5CF100DD-0D52-4849-884A-34DFC4F81324",
  v2SecondLoopGroup: "CEE9AE89-C213-4DC8-8DAF-7BEE60293497",
  v2SecondLoopStart: "00E119C1-B3F3-4B21-A3F4-6F5CE2211532",
  v2SecondStart: "89DC68BF-15EB-49E6-BBD9-5F5DADEB7DA3",
  v2SecondBoundary: "78B78043-702A-4819-ACFD-AA602B57316B",
  v2SecondFind: "BE63F197-C739-4612-AD33-61B19A9B1EED",
  v2SecondCount: "9E863324-9904-4F40-836C-47684432229D",
  v2SecondOverflowGroup: "135CF953-B6D1-4F50-9458-380C448C3613",
  v2SecondOverflowDiscard: "684A67AA-5776-41BA-9F58-12BC5291D6D1",
  v2SecondOverflowAlert: "5AF3B650-D1D3-407D-9ADC-1AF84753A029",
  v2SecondCursorAdvance: "C19D204F-71BD-4EF9-8215-9B1D3AA658D3",
  v2SecondNothing: "18EBF9BB-EB34-48ED-B02E-B976822E3187",
  v2SecondLoopEnd: "E05E8E1E-8845-40C9-B505-293BFD71A946",
  v2SecondBatchNonzeroGroup: "95CD4AC6-195C-4F71-93D9-5045A97B59E9",
  v2SecondBatchInnerGroup: "A541C883-D5A8-4F4E-9E02-810BD10EB11A",
  v2SecondBatchInnerStart: "4D0F1B19-54A6-4896-8662-65CB58357182",
  v2SecondBatchInnerEnd: "8EB6B31A-66CA-436E-944D-159D0F3722C9",
  v2SecondBatchIncrement: "9FAE5125-99C3-4FC0-9FCF-F757235B61C8",
  v2SecondBatchIncrementSet: "0FDB2504-332F-4427-B819-3D4C5E2388D3",
  v2SecondBatchTotalOverflowGroup: "5389EE32-DFDD-4EFB-B42F-EBCB7A813F5E",
  v2SecondBatchDiscardTotal: "780F675D-87DE-4312-98ED-ECC605016389",
  v2SecondBatchTotalAlert: "E000A54F-FC00-4705-8DA9-D46876CE87F2",
  v2SecondBatchGuidText: "9DAAFC0A-E006-48F0-B9EC-3813ADBB5B70",
  v2SecondBatchBodyText: "90F444F4-026F-4B86-8F4D-DD6584F2732B",
  v2SecondBatchSenderText: "2FBB14E2-CAA2-424A-B93B-091025CA08D2",
  v2SecondBatchPrepare: "E9332A33-1ED1-46D0-B253-A46ABF00D7D4",
  v2EpsilonProbeStart: "846BAC5D-F53D-4DE3-BF53-0DFC2C9E067E",
  v2EpsilonProbeDuration: "8AEE4807-AD09-437D-B2A2-E67D7003FC76",
  v2EpsilonProbeGuardGroup: "5E744086-7A84-49EA-8D6D-FE2A4C706872",
  v2EpsilonProbeAlert: "6822C3F4-7392-422F-B652-AEFCF99929AE",
  dualHistoryStart: "529FCD3E-F656-410D-B6B4-5A1B0239ED15",
  dualHistoryStartSet: "69C782C3-7314-4C71-B7F5-7084CA84B1A0",
  dualTomorrowBase: "C00418F9-7E7E-434E-9251-FEC41C1DD283",
  dualHistoryEnd: "A52D1288-98B9-4AB8-BDEB-82A6BBFA0BCC",
  dualHistoryEndSet: "0EF95EE0-7F44-4FDC-B99C-B65E76B35DC0",
  dualInitialOverlap: "E9404B68-BE88-4570-8E46-AB7138D991FD",
  dualOverlapSet: "AF5BC6B2-9050-4081-BDDA-6B5811BBECC3",
  dualLatestFind: "7AD5B568-3649-41B9-9D3D-71A6387DC250",
  dualLatestCount: "39A2C83E-8773-48AD-8183-05860694D6B8",
  dualZeroGroup: "AE31E2D5-FA1B-48EA-92CE-3A9521612C40",
  dualZeroAlert: "53FA270B-E8DE-4169-80FE-70AB9451C6AB",
  dualBoundaryItem: "8483411D-E48C-47D0-9BC7-4CD98D9D100A",
  dualBoundaryGuid: "0EEA21E5-D5A2-467D-B2DA-8716BB678820",
  dualNewestItem: "DA233039-48E5-4C19-BDCB-B30BC77BE30E",
  dualNewestGuid: "EDAB6B25-6EE9-4CFE-9B5B-3FE27E39AEEB",
  dualNewestEmptyGroup: "796EABAD-60BE-4DEF-93BF-A4B1B85CDE44",
  dualNewestEmptyAlert: "66AFFD26-CCCD-4DE0-8584-18DB05363A47",
  dualBoundaryEmptyGroup: "38AC68C8-D967-4645-9BBD-6B204C2718D6",
  dualBoundaryEmptyAlert: "07226609-A139-40FA-93CD-C568E147797D",
  dualLatestRepeatGroup: "AFA16032-4C0F-4512-93C4-5A9F879E8AA5",
  dualLatestRepeatStart: "663B2D53-48AA-4CAA-9E60-8AC2AE60305A",
  dualLatestIncrement: "6DD95994-C118-4F19-9784-7EB05D156EB5",
  dualLatestIncrementSet: "307225A6-8E79-428C-A603-8B1061FFEE98",
  dualLatestOverflowGroup: "0219250A-5213-4231-A07B-59E453A3B322",
  dualLatestDiscard: "698F7FDD-7F8E-40AF-B67B-FB30BC7DB582",
  dualLatestOverflowAlert: "3ECEBC43-60E5-4667-B421-50054F46AC9D",
  dualLatestGuid: "C1A51FDA-00CE-446E-991D-5BCA8024ECC9",
  dualLatestBody: "A37D1561-D1D4-4134-8FEF-971214FEBAC8",
  dualLatestSender: "C914903C-59EA-4055-A5EA-F4E54B1D0957",
  dualLatestPrepare: "C3F5A47C-E962-4F30-B642-7125DBDDEC36",
  dualLatestRepeatEnd: "F9A5C546-F11D-4F90-86B7-31DFF4C7611B",
  dualLatestRelease: "02E28462-3D63-4173-B300-82D1B892BE7E",
  dualOldestFind: "C93F90AF-5C73-4DBD-8AF4-0BA0A1505E97",
  dualOldestCount: "3D25276A-F0D4-410D-88C6-F26D27997C8F",
  dualOldestExtremeItem: "B67A2C54-1E26-47E7-A80C-A93483F8655D",
  dualOldestExtremeGuid: "039C27C4-8C37-4148-82A5-A66C430B9760",
  dualOldestEmptyGroup: "DBB3F32E-480C-499D-8FBD-276519040217",
  dualOldestEmptyDiscard: "C6ACD437-EEA8-4491-A139-56CBFEB50537",
  dualOldestEmptyAlert: "3AA5FDA1-45C8-4E96-B791-DC0F63B15EDA",
  dualLatestProbeFind: "8A9C56E4-CEBF-4363-AE7A-30C575CDD591",
  dualLatestProbeItem: "7E2C34A3-2DC9-4658-A204-36301623DE3F",
  dualLatestProbeGuid: "E92D44E3-5DCA-4347-A263-81C5202352DF",
  dualLatestProbeMismatchGroup: "D0899220-637C-4878-911E-A3B6F8ABEBFE",
  dualLatestProbeMismatchDiscard: "1AD62638-A572-441E-9D0E-630E4160CC9C",
  dualLatestProbeMismatchAlert: "C2871FC4-EA82-435B-B4C4-B045ADD1E819",
  dualOldestProbeFind: "97C3FCEA-9EFF-4F93-9870-B46C4C34F256",
  dualOldestProbeItem: "727C2BC5-09C7-439C-9517-BA7CD6612A3E",
  dualOldestProbeGuid: "E9261840-629F-4424-969A-5B7EF7C26FA5",
  dualOldestProbeMismatchGroup: "A29845DA-2B84-4D91-858F-0753D2260F8E",
  dualOldestProbeMismatchDiscard: "F4A990EA-1EFF-4951-910B-D47CB45345D3",
  dualOldestProbeMismatchAlert: "1D312998-63FB-42CC-8E4A-047A0D0C09C1",
  dualSameExtremeGroup: "ADC47611-4034-4DE0-9E36-BD3B9F20BA3D",
  dualSameExtremeCountGroup: "C0C86979-0E97-483F-99DD-AAA54C379CBC",
  dualSameExtremeDiscard: "92332E0C-6966-431E-9608-E746F6FFE804",
  dualSameExtremeAlert: "6450925F-B828-4F47-A0BD-AC85DD73ABB4",
  dualCountDifference: "6D1D410D-6BE9-4AB5-A1E6-006AF7548D7C",
  dualCountDifferenceSquared: "ECA23334-1115-429C-B1A6-BF6EB9E198B4",
  dualCountMismatchGroup: "14D93940-4C5A-4E0C-9240-CB96B1050E0F",
  dualCountMismatchDiscard: "934092AA-7A10-4782-81FE-130E87086E9D",
  dualCountMismatchAlert: "62A348A6-982D-4E8D-82A2-7BC39C570FF5",
  dualOldestRepeatGroup: "33F7F89D-CC67-4E68-B7B7-62904F569436",
  dualOldestRepeatStart: "A8EFB079-C37C-4105-9154-28E4461C10D3",
  dualReverseBase: "1EBB6EFE-0B42-4422-A307-142C652C3E8E",
  dualReverseIndex: "0EE7D71C-A147-48CC-BBA1-EBB8DE1A701F",
  dualReversedItem: "E3903415-BC89-4488-826D-D6F0619EC767",
  dualOldestIncrement: "592A2578-6C50-4E28-A865-5C0CFE749B3E",
  dualOldestIncrementSet: "F6E82CEA-0418-4292-A918-26593B6BCBEB",
  dualOldestOverflowGroup: "3B2790A3-BE94-4078-970E-3621DA83D1EE",
  dualOldestDiscard: "9C509F15-E91F-4F3D-B9AB-AD0B736B2DB2",
  dualOldestOverflowAlert: "B2FEBA98-F20E-4921-853D-CA82EEAC496F",
  dualOldestGuid: "70135012-BE9E-4B75-ABE6-87911CFF25CD",
  dualOldestBody: "8A8540AB-B547-4ED5-AC97-EA724B0DC1D1",
  dualOldestSender: "0D581819-A41C-42ED-BB90-02637794783D",
  dualOverlapGroup: "06F20E10-D615-4871-AA4B-4B53883009A6",
  dualOverlapOne: "8DED6120-2946-4D53-A8EA-0F5892FC6CA5",
  dualOverlapSetOne: "C04A60E9-7D92-4F85-B972-C67B1E7DCF37",
  dualOldestPrepare: "7E3C62A0-4923-4F4C-BAF3-93A7C279359C",
  dualOldestRepeatEnd: "02685770-7B40-4614-8659-836DD043EE6C",
  dualOldestRelease: "BAFE06E5-C2EA-4D11-A8F8-4753E3E87DB4",
  dualNoCoverageGroup: "7B43327E-9111-4BD2-AEDD-09448E7DC21C",
  dualNoCoverageDiscard: "C3CC8E28-5CB5-4AE2-A4F2-4CD3128ED61B",
  dualNoCoverageAlert: "7CD13067-B23A-417C-92AD-AC0895295DFB",
};

const actionOutputValue = (outputUUID, outputName) => ({
  Type: "ActionOutput",
  OutputUUID: outputUUID,
  OutputName: outputName,
});

const actionOutput = (outputUUID, outputName) => ({
  Value: actionOutputValue(outputUUID, outputName),
  WFSerializationType: "WFTextTokenAttachment",
});

const namedVariable = (variableName, aggrandizements = []) => ({
  Value: {
    Type: "Variable",
    VariableName: variableName,
    ...(aggrandizements.length > 0 ? { Aggrandizements: aggrandizements } : {}),
  },
  WFSerializationType: "WFTextTokenAttachment",
});

const namedVariableTextToken = (variableName, aggrandizements = []) =>
  textToken("\ufffc", {
    "{0, 1}": {
      Type: "Variable",
      VariableName: variableName,
      ...(aggrandizements.length > 0
        ? { Aggrandizements: aggrandizements }
        : {}),
    },
  });

const textToken = (string, attachmentsByRange = undefined) => ({
  Value: { string, ...(attachmentsByRange ? { attachmentsByRange } : {}) },
  WFSerializationType: "WFTextTokenString",
});

const outputTextToken = (outputUUID, outputName) =>
  textToken("\ufffc", { "{0, 1}": actionOutputValue(outputUUID, outputName) });

const outputPropertyTextToken = (
  outputUUID,
  outputName,
  propertyName,
  coerceToText = false,
) =>
  textToken("\ufffc", {
    "{0, 1}": {
      ...actionOutputValue(outputUUID, outputName),
      Aggrandizements: [
        property(propertyName),
        ...(coerceToText ? [coercion("WFStringContentItem")] : []),
      ],
    },
  });

const textWithOutput = (prefix, suffix, outputUUID, outputName) =>
  textToken(`${prefix}\ufffc${suffix}`, {
    [`{${prefix.length}, 1}`]: actionOutputValue(outputUUID, outputName),
  });

const property = (propertyName) => ({
  Type: "WFPropertyVariableAggrandizement",
  PropertyName: propertyName,
});

const coercion = (itemClass) => ({
  Type: "WFCoercionVariableAggrandizement",
  CoercionItemClass: itemClass,
});

const repeatPropertyTextAction = (uuid, customOutputName, propertyName) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFTextActionText: textToken("\ufffc", {
      "{0, 1}": {
        Type: "Variable",
        VariableName: "Repeat Item",
        Aggrandizements: [
          property(propertyName),
          coercion("WFStringContentItem"),
        ],
      },
    }),
  },
});

const outputPropertyTextAction = (
  uuid,
  customOutputName,
  outputUUID,
  outputName,
  propertyName,
) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFTextActionText: outputPropertyTextToken(
      outputUUID,
      outputName,
      propertyName,
      true,
    ),
  },
});

const quantity = (magnitude, unit) => ({
  Value: { Magnitude: magnitude, Unit: unit },
  WFSerializationType: "WFQuantityFieldValue",
});

const currentDate = (uuid) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.date",
  WFWorkflowActionParameters: { UUID: uuid, WFDateActionMode: "Current Date" },
});

const adjustDate = (
  uuid,
  customOutputName,
  date,
  operation,
  duration = undefined,
) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.adjustdate",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFDate: date,
    WFAdjustOperation: operation,
    ...(duration ? { WFDuration: duration } : {}),
  },
});

const alertAction = (uuid, title, message, showCancel = false) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.alert",
  WFWorkflowActionParameters: {
    UUID: uuid,
    WFAlertActionTitle: title,
    WFAlertActionMessage: message,
    WFAlertActionCancelButtonShown: showCancel,
  },
});

const conditionalStart = (group, input, condition, numberValue) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
  WFWorkflowActionParameters: {
    GroupingIdentifier: group,
    WFControlFlowMode: 0,
    WFInput: { Type: "Variable", Variable: input },
    WFCondition: condition,
    WFNumberValue: numberValue,
  },
});

const conditionalEnd = (group) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
  WFWorkflowActionParameters: {
    GroupingIdentifier: group,
    WFControlFlowMode: 2,
  },
});

const conditionalOtherwise = (group) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
  WFWorkflowActionParameters: {
    GroupingIdentifier: group,
    WFControlFlowMode: 1,
  },
});

const conditionalTextStart = (group, input, comparison) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
  WFWorkflowActionParameters: {
    GroupingIdentifier: group,
    WFControlFlowMode: 0,
    WFInput: { Type: "Variable", Variable: input },
    WFCondition: 4,
    WFConditionalActionString: comparison,
  },
});

const conditionalTextNotEqualStart = (group, input, comparison) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
  WFWorkflowActionParameters: {
    GroupingIdentifier: group,
    WFControlFlowMode: 0,
    WFInput: { Type: "Variable", Variable: input },
    WFCondition: 5,
    WFConditionalActionString: comparison,
  },
});

const conditionalEmptyStart = (group, input) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
  WFWorkflowActionParameters: {
    GroupingIdentifier: group,
    WFControlFlowMode: 0,
    WFInput: { Type: "Variable", Variable: input },
    WFCondition: 101,
  },
});

const stopAction = () => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.exit",
  WFWorkflowActionParameters: {},
});

const appIntentDescriptor = (identifier) => ({
  TeamIdentifier: APP_TEAM_ID,
  BundleIdentifier: APP_BUNDLE_ID,
  Name: "Wafra",
  AppIntentIdentifier: identifier,
});

const setVariable = (uuid, variableName, input) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.setvariable",
  WFWorkflowActionParameters: {
    UUID: uuid,
    WFVariableName: variableName,
    WFInput: input,
  },
});

const numberAction = (uuid, customOutputName, value) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.number",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFNumberActionNumber: String(value),
  },
});

const formatDateAction = (uuid, customOutputName, date, format) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.format.date",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFDate: outputTextToken(date.outputUUID, date.outputName),
    WFDateFormatStyle: "Custom",
    WFDateFormat: format,
    WFTimeFormatStyle: "None",
  },
});

const timeBetweenDatesAction = (
  uuid,
  customOutputName,
  fromDate,
  toDate,
  unit,
) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.gettimebetweendates",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFTimeUntilFromDate: fromDate,
    WFInput: toDate,
    WFTimeUntilUnit: unit,
  },
});

const repeatCountStart = (uuid, group, count) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.repeat.count",
  WFWorkflowActionParameters: {
    UUID: uuid,
    GroupingIdentifier: group,
    WFControlFlowMode: 0,
    WFRepeatCount: count,
  },
});

const repeatCountEnd = (uuid, group) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.repeat.count",
  WFWorkflowActionParameters: {
    UUID: uuid,
    GroupingIdentifier: group,
    WFControlFlowMode: 2,
  },
});

const incrementVariable = (uuid, variableName) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.math",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: "Next Prepared Position",
    WFInput: namedVariable(variableName),
    WFMathOperand: 1,
  },
});

const multiplyVariable = (
  uuid,
  customOutputName,
  variableName,
  multiplier,
) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.math",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFInput: namedVariable(variableName),
    WFMathOperation: "×",
    WFMathOperand: multiplier,
  },
});

const calculateAction = (
  uuid,
  customOutputName,
  input,
  operand,
  operation = undefined,
) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.math",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFInput: input,
    ...(operation ? { WFMathOperation: operation } : {}),
    WFMathOperand: operand,
  },
});

const nothingAction = (uuid) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.nothing",
  WFWorkflowActionParameters: { UUID: uuid },
});

const countItemsAction = (uuid, customOutputName, inputUUID, inputName) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.count",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFCountType: "Items",
    Input: actionOutput(inputUUID, inputName),
    WFInput: actionOutput(inputUUID, inputName),
  },
});

const getItemFromListAction = (
  uuid,
  input,
  specifier,
  index = undefined,
) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.getitemfromlist",
  WFWorkflowActionParameters: {
    UUID: uuid,
    WFItemSpecifier: specifier,
    ...(index ? { WFItemIndex: index } : {}),
    WFInput: input,
  },
});

const buildV2PrepareBatchActions = ({
  countUUID,
  countName,
  findUUID,
  nonzeroGroup,
  innerGroup,
  innerStart,
  innerEnd,
  increment,
  incrementSet,
  totalOverflowGroup,
  discardTotal,
  totalOverflowAlert,
  messageGuidText,
  messageBodyText,
  messageSenderText,
  prepare,
}) => [
  conditionalStart(nonzeroGroup, actionOutput(countUUID, countName), 2, 0),
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
    WFWorkflowActionParameters: {
      UUID: innerStart,
      GroupingIdentifier: innerGroup,
      WFControlFlowMode: 0,
      WFInput: actionOutput(findUUID, "Message"),
    },
  },
  incrementVariable(increment, "Prepared Position"),
  setVariable(
    incrementSet,
    "Prepared Position",
    actionOutput(increment, "Next Prepared Position"),
  ),
  conditionalStart(
    totalOverflowGroup,
    namedVariable("Prepared Position"),
    2,
    10000,
  ),
  {
    WFWorkflowActionIdentifier: DISCARD_V2_INTENT,
    WFWorkflowActionParameters: {
      UUID: discardTotal,
      AppIntentDescriptor: appIntentDescriptor(
        "DiscardWafraPreparedHistoryV2Intent",
      ),
      sessionId: outputTextToken(ids.sessionId, "Session ID"),
    },
  },
  alertAction(
    totalOverflowAlert,
    "Yearly Message limit reached",
    "This import contains more than 10,000 Message references. Wafra stopped and erased the partial import.",
  ),
  stopAction(),
  conditionalEnd(totalOverflowGroup),
  repeatPropertyTextAction(messageGuidText, "Message GUID", "GUID"),
  repeatPropertyTextAction(messageBodyText, "Message Body", "Body"),
  repeatPropertyTextAction(messageSenderText, "Message Sender", "Sender"),
  {
    WFWorkflowActionIdentifier: PREPARE_V2_INTENT,
    WFWorkflowActionParameters: {
      UUID: prepare,
      AppIntentDescriptor: appIntentDescriptor(
        "PrepareWafraHistoryMessageV2Intent",
      ),
      sessionId: outputTextToken(ids.sessionId, "Session ID"),
      position: namedVariable("Prepared Position"),
      rangeStart: namedVariableTextToken("History Start"),
      rangeEnd: namedVariableTextToken("History End"),
      messageGUID: outputTextToken(messageGuidText, "Message GUID"),
      body: outputTextToken(messageBodyText, "Message Body"),
      sender: outputTextToken(messageSenderText, "Message Sender"),
      date: namedVariableTextToken("Repeat Item", [property("date")]),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
    WFWorkflowActionParameters: {
      UUID: innerEnd,
      GroupingIdentifier: innerGroup,
      WFControlFlowMode: 2,
    },
  },
  conditionalEnd(nonzeroGroup),
];

const rangeMenuAction = (mode, itemTitle = undefined) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.choosefrommenu",
  WFWorkflowActionParameters: {
    GroupingIdentifier: ids.rangeMenu,
    WFControlFlowMode: mode,
    ...(mode === 0
      ? {
          WFMenuPrompt: "Which Messages should Wafra check?",
          WFMenuItems: ["Last 30 days", "This year", "Choose a year"],
        }
      : {}),
    ...(mode === 1 ? { WFMenuItemTitle: itemTitle } : {}),
  },
});

const askDate = (uuid, customOutputName, prompt) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.ask",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFAskActionDateGranularity: "Date",
    WFAskActionPrompt: prompt,
    WFInputType: "Date",
  },
});

const findMessagesAction = ({
  uuid = ids.find,
  startDate,
  endDate,
  hardStartDate = undefined,
  hardEndDate = undefined,
  additionalStartDates = [],
  messageLimit = null,
}) => ({
  WFWorkflowActionIdentifier: FIND_MESSAGES,
  WFWorkflowActionParameters: {
    UUID: uuid,
    AppIntentDescriptor: {
      TeamIdentifier: "0000000000",
      BundleIdentifier: "com.apple.MobileSMS",
      Name: "Messages",
      AppIntentIdentifier: "MessageEntity",
      ActionRequiresAppInstallation: true,
    },
    WFContentItemFilter: {
      WFSerializationType: "WFContentPredicateTableTemplate",
      Value: {
        WFActionParameterFilterPrefix: 1,
        WFContentPredicateBoundedDate: false,
        WFActionParameterFilterTemplates: [
          {
            Property: "date",
            Operator: 2,
            Removable: true,
            Values: { Unit: 4, Date: startDate },
          },
          {
            Property: "date",
            Operator: 0,
            Removable: true,
            Values: { Unit: 4, Date: endDate },
          },
          ...(hardEndDate
            ? [
                {
                  Property: "date",
                  Operator: 0,
                  Removable: true,
                  Values: { Unit: 4, Date: hardEndDate },
                },
              ]
            : []),
          ...(hardStartDate
            ? [
                {
                  Property: "date",
                  Operator: 2,
                  Removable: true,
                  Values: { Unit: 4, Date: hardStartDate },
                },
              ]
            : []),
          ...additionalStartDates.map((date) => ({
            Property: "date",
            Operator: 2,
            Removable: true,
            Values: { Unit: 4, Date: date },
          })),
        ],
      },
    },
    WFContentItemSortProperty: "date",
    WFContentItemSortOrder: "Latest First",
    ...(messageLimit === null
      ? {}
      : {
          WFContentItemLimitEnabled: true,
          WFContentItemLimitNumber: messageLimit,
        }),
  },
});

const findBoundedMessagesAction = (uuid, sortOrder, messageLimit) => ({
  WFWorkflowActionIdentifier: FIND_MESSAGES,
  WFWorkflowActionParameters: {
    UUID: uuid,
    AppIntentDescriptor: {
      TeamIdentifier: "0000000000",
      BundleIdentifier: "com.apple.MobileSMS",
      Name: "Messages",
      AppIntentIdentifier: "MessageEntity",
      ActionRequiresAppInstallation: true,
    },
    WFContentItemFilter: {
      WFSerializationType: "WFContentPredicateTableTemplate",
      Value: {
        WFActionParameterFilterPrefix: 1,
        WFContentPredicateBoundedDate: false,
        WFActionParameterFilterTemplates: [],
      },
    },
    WFContentItemSortProperty: "date",
    WFContentItemSortOrder: sortOrder,
    WFContentItemLimitEnabled: true,
    WFContentItemLimitNumber: messageLimit,
  },
});

const discardPreparedV2Action = (uuid) => ({
  WFWorkflowActionIdentifier: DISCARD_V2_INTENT,
  WFWorkflowActionParameters: {
    UUID: uuid,
    AppIntentDescriptor: appIntentDescriptor(
      "DiscardWafraPreparedHistoryV2Intent",
    ),
    sessionId: outputTextToken(ids.sessionId, "Session ID"),
  },
});

const prepareMessageV3Action = ({
  uuid,
  guidUUID,
  bodyUUID,
  senderUUID,
  date,
}) => ({
  WFWorkflowActionIdentifier: PREPARE_V3_INTENT,
  WFWorkflowActionParameters: {
    UUID: uuid,
    AppIntentDescriptor: appIntentDescriptor(
      "PrepareWafraHistoryMessageV3Intent",
    ),
    sessionId: outputTextToken(ids.sessionId, "Session ID"),
    position: namedVariable("Prepared Position"),
    messageGUID: outputTextToken(guidUUID, "Message GUID"),
    body: outputTextToken(bodyUUID, "Message Body"),
    sender: outputTextToken(senderUUID, "Message Sender"),
    date,
  },
});

const totalOverflowActions = ({ group, discard, alert }) => [
  conditionalStart(group, namedVariable("Prepared Position"), 2, 10000),
  discardPreparedV2Action(discard),
  alertAction(
    alert,
    "Message safety limit reached",
    "Wafra stopped and erased the partial import before its 10,000-record safety limit.",
  ),
  stopAction(),
  conditionalEnd(group),
];

const validateMessageLimit = (messageLimit, smoke) => {
  if (smoke ? messageLimit !== 50 : messageLimit !== 1500) {
    throw new Error(
      smoke
        ? "smoke messageLimit must be exactly 50"
        : "production messageLimit must be exactly 1500",
    );
  }
};

const buildSmokePreamble = ({ messageLimit }) => [
  alertAction(
    ids.disclosure,
    "Import bank alert history",
    `This physical-device smoke test reads at most ${messageLimit} recent Messages from the last 30 calendar days and prepares them locally for review. Nothing is uploaded.`,
    true,
  ),
  currentDate(ids.now),
  adjustDate(
    ids.todayStart,
    "Today Start",
    actionOutput(ids.now, "Date"),
    "Get Start of Day",
  ),
  adjustDate(
    ids.minusThirtyDays,
    "First Included Day",
    actionOutput(ids.todayStart, "Today Start"),
    "Subtract",
    quantity(29, "days"),
  ),
  adjustDate(
    ids.startBoundary,
    "Start Boundary",
    actionOutput(ids.minusThirtyDays, "First Included Day"),
    "Subtract",
    quantity(1, "seconds"),
  ),
  adjustDate(
    ids.tomorrowBase,
    "Tomorrow Base",
    actionOutput(ids.now, "Date"),
    "Get Start of Day",
  ),
  adjustDate(
    ids.exclusiveEnd,
    "Exclusive End",
    actionOutput(ids.tomorrowBase, "Tomorrow Base"),
    "Add",
    quantity(1, "days"),
  ),
  findMessagesAction({
    startDate: actionOutput(ids.startBoundary, "Start Boundary"),
    endDate: actionOutput(ids.exclusiveEnd, "Exclusive End"),
    messageLimit,
  }),
];

/**
 * Retained only to reproduce Apple's iOS 26.6 date-filter defect. The
 * production graph below must not call this date-window diagnostic.
 */
export const buildAdaptiveHistoryDiagnostic = () => [
  alertAction(
    ids.disclosure,
    "Import bank alert history",
    "Wafra checks one day at a time and automatically splits dense days into hours, then minutes, then seconds, so Apple Shortcuts stays within its memory limit. Choose up to one year. One run accepts at most 10,000 Message references. This can take 20 minutes or more. Keep this iPhone unlocked and Shortcuts open until Wafra opens. Nothing is uploaded.",
    true,
  ),
  currentDate(ids.now),
  adjustDate(
    ids.v2EpsilonProbeStart,
    "Fractional Probe Start",
    actionOutput(ids.now, "Date"),
    "Subtract",
    quantity(0.001, "seconds"),
  ),
  timeBetweenDatesAction(
    ids.v2EpsilonProbeDuration,
    "Fractional Probe Seconds",
    actionOutput(ids.v2EpsilonProbeStart, "Fractional Probe Start"),
    actionOutput(ids.now, "Date"),
    "Seconds",
  ),
  conditionalStart(
    ids.v2EpsilonProbeGuardGroup,
    actionOutput(ids.v2EpsilonProbeDuration, "Fractional Probe Seconds"),
    3,
    0.0005,
  ),
  alertAction(
    ids.v2EpsilonProbeAlert,
    "Precise Message windows unavailable",
    "This iPhone rounds Shortcuts date windows too coarsely to import dense Message history without risking a skipped boundary. Nothing was imported.",
  ),
  stopAction(),
  conditionalEnd(ids.v2EpsilonProbeGuardGroup),
  adjustDate(
    ids.todayStart,
    "Today Start",
    actionOutput(ids.now, "Date"),
    "Get Start of Day",
  ),
  adjustDate(
    ids.minusThirtyDays,
    "First Included Day",
    actionOutput(ids.todayStart, "Today Start"),
    "Subtract",
    quantity(29, "days"),
  ),
  adjustDate(
    ids.exclusiveEnd,
    "Tomorrow Start",
    actionOutput(ids.todayStart, "Today Start"),
    "Add",
    quantity(1, "days"),
  ),
  adjustDate(
    ids.yearStart,
    "Year Start",
    actionOutput(ids.now, "Date"),
    "Get Start of Year",
  ),
  formatDateAction(
    ids.v2YearCount,
    "Year-to-date Days",
    { outputUUID: ids.now, outputName: "Date" },
    "D",
  ),
  rangeMenuAction(0),
  rangeMenuAction(1, "Last 30 days"),
  setVariable(
    ids.last30SetStart,
    "History Start",
    actionOutput(ids.minusThirtyDays, "First Included Day"),
  ),
  setVariable(
    ids.last30SetEnd,
    "History End",
    actionOutput(ids.exclusiveEnd, "Tomorrow Start"),
  ),
  numberAction(ids.v2Last30Count, "Thirty Days", 30),
  setVariable(
    ids.v2Last30SetCount,
    "Day Count",
    actionOutput(ids.v2Last30Count, "Thirty Days"),
  ),
  rangeMenuAction(1, "This year"),
  setVariable(
    ids.yearSetStart,
    "History Start",
    actionOutput(ids.yearStart, "Year Start"),
  ),
  setVariable(
    ids.yearSetEnd,
    "History End",
    actionOutput(ids.exclusiveEnd, "Tomorrow Start"),
  ),
  setVariable(
    ids.v2YearSetCount,
    "Day Count",
    actionOutput(ids.v2YearCount, "Year-to-date Days"),
  ),
  rangeMenuAction(1, "Choose a year"),
  askDate(ids.v2ChosenYear, "Chosen Year Date", "Choose any date in the year"),
  adjustDate(
    ids.v2ChosenYearStart,
    "Chosen Year Start",
    actionOutput(ids.v2ChosenYear, "Chosen Year Date"),
    "Get Start of Year",
  ),
  adjustDate(
    ids.v2ChosenYearEnd,
    "Chosen Year End",
    actionOutput(ids.v2ChosenYearStart, "Chosen Year Start"),
    "Add",
    quantity(1, "years"),
  ),
  setVariable(
    ids.customSetStart,
    "History Start",
    actionOutput(ids.v2ChosenYearStart, "Chosen Year Start"),
  ),
  setVariable(
    ids.customSetEnd,
    "History End",
    actionOutput(ids.v2ChosenYearEnd, "Chosen Year End"),
  ),
  numberAction(ids.v2ChosenCount, "Maximum Chosen Year Days", 366),
  setVariable(
    ids.v2ChosenSetCount,
    "Day Count",
    actionOutput(ids.v2ChosenCount, "Maximum Chosen Year Days"),
  ),
  rangeMenuAction(2),
  multiplyVariable(ids.v2WindowCount, "Adaptive Day Count", "Day Count", 1),
  adjustDate(
    ids.v2RangeStartBoundary,
    "Selected Range Start Boundary",
    namedVariable("History Start"),
    "Subtract",
    quantity(1, "seconds"),
  ),
  alertAction(
    ids.confirmation,
    "Review before import",
    "Continue to check the selected dates in bounded local batches? No Message text is uploaded.",
    true,
  ),
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.number.random",
    WFWorkflowActionParameters: {
      UUID: ids.randomA,
      WFRandomNumberMinimum: 0,
      WFRandomNumberMaximum: 999999999999999,
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.number.random",
    WFWorkflowActionParameters: {
      UUID: ids.randomB,
      WFRandomNumberMinimum: 0,
      WFRandomNumberMaximum: 999999999999999,
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
    WFWorkflowActionParameters: {
      UUID: ids.sessionId,
      CustomOutputName: "Session ID",
      WFTextActionText: textToken("WAFRA-\ufffc-\ufffc", {
        "{6, 1}": actionOutputValue(ids.randomA, "Random Number"),
        "{8, 1}": actionOutputValue(ids.randomB, "Random Number"),
      }),
    },
  },
  setVariable(ids.v2CursorSet, "History Cursor", namedVariable("History End")),
  numberAction(ids.v2PositionInitial, "Initial Prepared Position", 0),
  setVariable(
    ids.v2PositionSet,
    "Prepared Position",
    actionOutput(ids.v2PositionInitial, "Initial Prepared Position"),
  ),
  repeatCountStart(
    ids.v2OuterStart,
    ids.v2OuterGroup,
    actionOutput(ids.v2WindowCount, "Adaptive Day Count"),
  ),
  adjustDate(
    ids.v2DayEnd,
    "Day Start",
    namedVariable("History Cursor"),
    "Subtract",
    quantity(1, "days"),
  ),
  adjustDate(
    ids.startBoundary,
    "Day Start Boundary",
    actionOutput(ids.v2DayEnd, "Day Start"),
    "Subtract",
    quantity(1, "seconds"),
  ),
  findMessagesAction({
    uuid: ids.find,
    startDate: actionOutput(ids.startBoundary, "Day Start Boundary"),
    endDate: namedVariable("History Cursor"),
    hardStartDate: actionOutput(
      ids.v2RangeStartBoundary,
      "Selected Range Start Boundary",
    ),
    hardEndDate: namedVariable("History End"),
    messageLimit: 101,
  }),
  countItemsAction(ids.found, "Day Messages Found", ids.find, "Message"),
  conditionalStart(
    ids.v2DayDenseGroup,
    actionOutput(ids.found, "Day Messages Found"),
    2,
    100,
  ),
  setVariable(
    ids.v2HourCursorSet,
    "Hour Cursor",
    namedVariable("History Cursor"),
  ),
  repeatCountStart(ids.v2HourLoopStart, ids.v2HourLoopGroup, 26),
  adjustDate(
    ids.v2HourStart,
    "Hour Start",
    namedVariable("Hour Cursor"),
    "Subtract",
    quantity(1, "hours"),
  ),
  adjustDate(
    ids.v2HourBoundary,
    "Hour Start Boundary",
    actionOutput(ids.v2HourStart, "Hour Start"),
    "Subtract",
    quantity(1, "seconds"),
  ),
  findMessagesAction({
    uuid: ids.v2HourFind,
    startDate: actionOutput(ids.v2HourBoundary, "Hour Start Boundary"),
    endDate: namedVariable("Hour Cursor"),
    hardStartDate: actionOutput(
      ids.v2RangeStartBoundary,
      "Selected Range Start Boundary",
    ),
    hardEndDate: namedVariable("History End"),
    additionalStartDates: [
      actionOutput(ids.startBoundary, "Day Start Boundary"),
    ],
    messageLimit: 101,
  }),
  countItemsAction(
    ids.v2HourCount,
    "Hour Messages Found",
    ids.v2HourFind,
    "Message",
  ),
  conditionalStart(
    ids.v2HourDenseGroup,
    actionOutput(ids.v2HourCount, "Hour Messages Found"),
    2,
    100,
  ),
  setVariable(
    ids.v2MinuteCursorSet,
    "Minute Cursor",
    namedVariable("Hour Cursor"),
  ),
  repeatCountStart(ids.v2MinuteLoopStart, ids.v2MinuteLoopGroup, 60),
  adjustDate(
    ids.v2MinuteStart,
    "Minute Start",
    namedVariable("Minute Cursor"),
    "Subtract",
    quantity(1, "minutes"),
  ),
  adjustDate(
    ids.v2MinuteBoundary,
    "Minute Start Boundary",
    actionOutput(ids.v2MinuteStart, "Minute Start"),
    "Subtract",
    quantity(1, "seconds"),
  ),
  findMessagesAction({
    uuid: ids.v2MinuteFind,
    startDate: actionOutput(ids.v2MinuteBoundary, "Minute Start Boundary"),
    endDate: namedVariable("Minute Cursor"),
    hardStartDate: actionOutput(
      ids.v2RangeStartBoundary,
      "Selected Range Start Boundary",
    ),
    hardEndDate: namedVariable("History End"),
    messageLimit: 101,
  }),
  countItemsAction(
    ids.v2MinuteCount,
    "Minute Messages Found",
    ids.v2MinuteFind,
    "Message",
  ),
  conditionalStart(
    ids.v2MinuteOverflowGroup,
    actionOutput(ids.v2MinuteCount, "Minute Messages Found"),
    2,
    100,
  ),
  setVariable(
    ids.v2SecondCursorSet,
    "Second Cursor",
    namedVariable("Minute Cursor"),
  ),
  repeatCountStart(ids.v2SecondLoopStart, ids.v2SecondLoopGroup, 60),
  adjustDate(
    ids.v2SecondStart,
    "Second Start",
    namedVariable("Second Cursor"),
    "Subtract",
    quantity(1, "seconds"),
  ),
  adjustDate(
    ids.v2SecondBoundary,
    "Second Start Boundary",
    actionOutput(ids.v2SecondStart, "Second Start"),
    "Subtract",
    quantity(0.001, "seconds"),
  ),
  findMessagesAction({
    uuid: ids.v2SecondFind,
    startDate: actionOutput(ids.v2SecondBoundary, "Second Start Boundary"),
    endDate: namedVariable("Second Cursor"),
    hardStartDate: actionOutput(
      ids.v2RangeStartBoundary,
      "Selected Range Start Boundary",
    ),
    hardEndDate: namedVariable("History End"),
    messageLimit: 501,
  }),
  countItemsAction(
    ids.v2SecondCount,
    "Second Messages Found",
    ids.v2SecondFind,
    "Message",
  ),
  conditionalStart(
    ids.v2SecondOverflowGroup,
    actionOutput(ids.v2SecondCount, "Second Messages Found"),
    2,
    500,
  ),
  {
    WFWorkflowActionIdentifier: DISCARD_V2_INTENT,
    WFWorkflowActionParameters: {
      UUID: ids.v2SecondOverflowDiscard,
      AppIntentDescriptor: appIntentDescriptor(
        "DiscardWafraPreparedHistoryV2Intent",
      ),
      sessionId: outputTextToken(ids.sessionId, "Session ID"),
    },
  },
  alertAction(
    ids.v2SecondOverflowAlert,
    "Finest Message window limit reached",
    "The finest approximately one-second window contains more than 500 retained Messages. Apple Shortcuts cannot page that window, so Wafra stopped and erased the partial import without skipping anything silently.",
  ),
  stopAction(),
  conditionalEnd(ids.v2SecondOverflowGroup),
  ...buildV2PrepareBatchActions({
    countUUID: ids.v2SecondCount,
    countName: "Second Messages Found",
    findUUID: ids.v2SecondFind,
    nonzeroGroup: ids.v2SecondBatchNonzeroGroup,
    innerGroup: ids.v2SecondBatchInnerGroup,
    innerStart: ids.v2SecondBatchInnerStart,
    innerEnd: ids.v2SecondBatchInnerEnd,
    increment: ids.v2SecondBatchIncrement,
    incrementSet: ids.v2SecondBatchIncrementSet,
    totalOverflowGroup: ids.v2SecondBatchTotalOverflowGroup,
    discardTotal: ids.v2SecondBatchDiscardTotal,
    totalOverflowAlert: ids.v2SecondBatchTotalAlert,
    messageGuidText: ids.v2SecondBatchGuidText,
    messageBodyText: ids.v2SecondBatchBodyText,
    messageSenderText: ids.v2SecondBatchSenderText,
    prepare: ids.v2SecondBatchPrepare,
  }),
  setVariable(
    ids.v2SecondCursorAdvance,
    "Second Cursor",
    actionOutput(ids.v2SecondStart, "Second Start"),
  ),
  nothingAction(ids.v2SecondNothing),
  repeatCountEnd(ids.v2SecondLoopEnd, ids.v2SecondLoopGroup),
  conditionalOtherwise(ids.v2MinuteOverflowGroup),
  ...buildV2PrepareBatchActions({
    countUUID: ids.v2MinuteCount,
    countName: "Minute Messages Found",
    findUUID: ids.v2MinuteFind,
    nonzeroGroup: ids.v2MinuteBatchNonzeroGroup,
    innerGroup: ids.v2MinuteBatchInnerGroup,
    innerStart: ids.v2MinuteBatchInnerStart,
    innerEnd: ids.v2MinuteBatchInnerEnd,
    increment: ids.v2MinuteBatchIncrement,
    incrementSet: ids.v2MinuteBatchIncrementSet,
    totalOverflowGroup: ids.v2MinuteBatchTotalOverflowGroup,
    discardTotal: ids.v2MinuteBatchDiscardTotal,
    totalOverflowAlert: ids.v2MinuteBatchTotalAlert,
    messageGuidText: ids.v2MinuteBatchGuidText,
    messageBodyText: ids.v2MinuteBatchBodyText,
    messageSenderText: ids.v2MinuteBatchSenderText,
    prepare: ids.v2MinuteBatchPrepare,
  }),
  conditionalEnd(ids.v2MinuteOverflowGroup),
  setVariable(
    ids.v2MinuteCursorAdvance,
    "Minute Cursor",
    actionOutput(ids.v2MinuteStart, "Minute Start"),
  ),
  nothingAction(ids.v2MinuteNothing),
  repeatCountEnd(ids.v2MinuteLoopEnd, ids.v2MinuteLoopGroup),
  conditionalOtherwise(ids.v2HourDenseGroup),
  ...buildV2PrepareBatchActions({
    countUUID: ids.v2HourCount,
    countName: "Hour Messages Found",
    findUUID: ids.v2HourFind,
    nonzeroGroup: ids.v2HourBatchNonzeroGroup,
    innerGroup: ids.v2HourBatchInnerGroup,
    innerStart: ids.v2HourBatchInnerStart,
    innerEnd: ids.v2HourBatchInnerEnd,
    increment: ids.v2HourBatchIncrement,
    incrementSet: ids.v2HourBatchIncrementSet,
    totalOverflowGroup: ids.v2HourBatchTotalOverflowGroup,
    discardTotal: ids.v2HourBatchDiscardTotal,
    totalOverflowAlert: ids.v2HourBatchTotalAlert,
    messageGuidText: ids.v2HourBatchGuidText,
    messageBodyText: ids.v2HourBatchBodyText,
    messageSenderText: ids.v2HourBatchSenderText,
    prepare: ids.v2HourBatchPrepare,
  }),
  conditionalEnd(ids.v2HourDenseGroup),
  setVariable(
    ids.v2HourCursorAdvance,
    "Hour Cursor",
    actionOutput(ids.v2HourStart, "Hour Start"),
  ),
  nothingAction(ids.v2HourNothing),
  repeatCountEnd(ids.v2HourLoopEnd, ids.v2HourLoopGroup),
  conditionalOtherwise(ids.v2DayDenseGroup),
  ...buildV2PrepareBatchActions({
    countUUID: ids.found,
    countName: "Day Messages Found",
    findUUID: ids.find,
    nonzeroGroup: ids.v2NonzeroGroup,
    innerGroup: ids.v2InnerGroup,
    innerStart: ids.v2InnerStart,
    innerEnd: ids.v2InnerEnd,
    increment: ids.v2Increment,
    incrementSet: ids.v2IncrementSet,
    totalOverflowGroup: ids.v2TotalOverflowGroup,
    discardTotal: ids.v2DiscardTotal,
    totalOverflowAlert: ids.v2TotalOverflowAlert,
    messageGuidText: ids.messageGuidText,
    messageBodyText: ids.messageBodyText,
    messageSenderText: ids.messageSenderText,
    prepare: ids.v2Prepare,
  }),
  conditionalEnd(ids.v2DayDenseGroup),
  setVariable(
    ids.v2CursorAdvance,
    "History Cursor",
    actionOutput(ids.v2DayEnd, "Day Start"),
  ),
  nothingAction(ids.v2Nothing),
  repeatCountEnd(ids.v2OuterEnd, ids.v2OuterGroup),
  conditionalStart(
    ids.v2ZeroTotalGroup,
    namedVariable("Prepared Position"),
    1,
    0,
  ),
  alertAction(
    ids.v2ZeroTotalAlert,
    "No Messages found",
    "No retained Messages matched the selected dates. Nothing was imported.",
  ),
  stopAction(),
  conditionalEnd(ids.v2ZeroTotalGroup),
  {
    WFWorkflowActionIdentifier: IMPORT_V2_INTENT,
    WFWorkflowActionParameters: {
      UUID: ids.v2FinalImport,
      AppIntentDescriptor: appIntentDescriptor(
        "ImportWafraPreparedHistoryV2Intent",
      ),
      sessionId: outputTextToken(ids.sessionId, "Session ID"),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.urlencode",
    WFWorkflowActionParameters: {
      UUID: ids.encoded,
      WFEncodeMode: "Encode",
      WFInput: outputTextToken(ids.sessionId, "Session ID"),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.url",
    WFWorkflowActionParameters: {
      UUID: ids.url,
      WFURLActionURL: textToken("wafra://import-sms?history=\ufffc", {
        "{27, 1}": actionOutputValue(ids.encoded, "URL Encoded Text"),
      }),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.openurl",
    WFWorkflowActionParameters: { WFInput: actionOutput(ids.url, "URL") },
  },
  stopAction(),
];

const buildProductionV2Actions = () => [
  alertAction(
    ids.disclosure,
    "Import retained Message history",
    "Wafra checks two bounded 1,500-message halves: newest first, then oldest first. It continues only when their GUID boundary overlaps; otherwise it erases the partial session. Apple controls Message ordering, so this is a beta coverage check for up to 2,999 retained Messages, not an unlimited inbox guarantee. Message text stays on this iPhone. Keep Shortcuts open until Wafra returns.",
    true,
  ),
  alertAction(
    ids.confirmation,
    "Ready to check this iPhone",
    "Continue to prepare retained Messages locally for review? Nothing is uploaded or filed until you review in Wafra.",
    true,
  ),
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.number.random",
    WFWorkflowActionParameters: {
      UUID: ids.randomA,
      WFRandomNumberMinimum: 0,
      WFRandomNumberMaximum: 999999999999999,
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.number.random",
    WFWorkflowActionParameters: {
      UUID: ids.randomB,
      WFRandomNumberMinimum: 0,
      WFRandomNumberMaximum: 999999999999999,
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
    WFWorkflowActionParameters: {
      UUID: ids.sessionId,
      CustomOutputName: "Session ID",
      WFTextActionText: textToken("WAFRA-\ufffc-\ufffc", {
        "{6, 1}": actionOutputValue(ids.randomA, "Random Number"),
        "{8, 1}": actionOutputValue(ids.randomB, "Random Number"),
      }),
    },
  },
  numberAction(ids.v2PositionInitial, "Initial Prepared Position", 0),
  setVariable(
    ids.v2PositionSet,
    "Prepared Position",
    actionOutput(ids.v2PositionInitial, "Initial Prepared Position"),
  ),
  numberAction(ids.dualInitialOverlap, "Initial Coverage Overlap", 0),
  setVariable(
    ids.dualOverlapSet,
    "Coverage Overlap",
    actionOutput(ids.dualInitialOverlap, "Initial Coverage Overlap"),
  ),
  findBoundedMessagesAction(ids.dualLatestFind, "Latest First", 1500),
  countItemsAction(
    ids.dualLatestCount,
    "Latest Messages Found",
    ids.dualLatestFind,
    "Message",
  ),
  conditionalStart(
    ids.dualZeroGroup,
    actionOutput(ids.dualLatestCount, "Latest Messages Found"),
    1,
    0,
  ),
  alertAction(
    ids.dualZeroAlert,
    "No retained Messages found",
    "Apple Shortcuts returned no Messages. Nothing was imported.",
  ),
  stopAction(),
  conditionalEnd(ids.dualZeroGroup),
  getItemFromListAction(
    ids.dualNewestItem,
    actionOutput(ids.dualLatestFind, "Message"),
    "First Item",
  ),
  outputPropertyTextAction(
    ids.dualNewestGuid,
    "Newest Extreme GUID",
    ids.dualNewestItem,
    "Item from List",
    "GUID",
  ),
  conditionalEmptyStart(
    ids.dualNewestEmptyGroup,
    actionOutput(ids.dualNewestGuid, "Newest Extreme GUID"),
  ),
  alertAction(
    ids.dualNewestEmptyAlert,
    "Newest Message could not be identified",
    "Apple did not provide the stable Message identifier required for a bounded, duplicate-safe import. Nothing was imported.",
  ),
  stopAction(),
  conditionalEnd(ids.dualNewestEmptyGroup),
  getItemFromListAction(
    ids.dualBoundaryItem,
    actionOutput(ids.dualLatestFind, "Message"),
    "Last Item",
  ),
  outputPropertyTextAction(
    ids.dualBoundaryGuid,
    "Coverage Boundary GUID",
    ids.dualBoundaryItem,
    "Item from List",
    "GUID",
  ),
  conditionalEmptyStart(
    ids.dualBoundaryEmptyGroup,
    actionOutput(ids.dualBoundaryGuid, "Coverage Boundary GUID"),
  ),
  alertAction(
    ids.dualBoundaryEmptyAlert,
    "Messages could not be identified",
    "Apple did not provide the stable Message identifier required for the boundary coverage check. Nothing was imported.",
  ),
  stopAction(),
  conditionalEnd(ids.dualBoundaryEmptyGroup),
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
    WFWorkflowActionParameters: {
      UUID: ids.dualLatestRepeatStart,
      GroupingIdentifier: ids.dualLatestRepeatGroup,
      WFControlFlowMode: 0,
      WFInput: actionOutput(ids.dualLatestFind, "Message"),
    },
  },
  incrementVariable(ids.dualLatestIncrement, "Prepared Position"),
  setVariable(
    ids.dualLatestIncrementSet,
    "Prepared Position",
    actionOutput(ids.dualLatestIncrement, "Next Prepared Position"),
  ),
  ...totalOverflowActions({
    group: ids.dualLatestOverflowGroup,
    discard: ids.dualLatestDiscard,
    alert: ids.dualLatestOverflowAlert,
  }),
  repeatPropertyTextAction(ids.dualLatestGuid, "Message GUID", "GUID"),
  repeatPropertyTextAction(ids.dualLatestBody, "Message Body", "Body"),
  repeatPropertyTextAction(ids.dualLatestSender, "Message Sender", "Sender"),
  prepareMessageV3Action({
    uuid: ids.dualLatestPrepare,
    guidUUID: ids.dualLatestGuid,
    bodyUUID: ids.dualLatestBody,
    senderUUID: ids.dualLatestSender,
    date: namedVariableTextToken("Repeat Item", [property("date")]),
  }),
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
    WFWorkflowActionParameters: {
      UUID: ids.dualLatestRepeatEnd,
      GroupingIdentifier: ids.dualLatestRepeatGroup,
      WFControlFlowMode: 2,
    },
  },
  nothingAction(ids.dualLatestRelease),
  findBoundedMessagesAction(ids.dualOldestFind, "Oldest First", 1500),
  countItemsAction(
    ids.dualOldestCount,
    "Oldest Messages Found",
    ids.dualOldestFind,
    "Message",
  ),
  getItemFromListAction(
    ids.dualOldestExtremeItem,
    actionOutput(ids.dualOldestFind, "Message"),
    "First Item",
  ),
  outputPropertyTextAction(
    ids.dualOldestExtremeGuid,
    "Oldest Extreme GUID",
    ids.dualOldestExtremeItem,
    "Item from List",
    "GUID",
  ),
  conditionalEmptyStart(
    ids.dualOldestEmptyGroup,
    actionOutput(ids.dualOldestExtremeGuid, "Oldest Extreme GUID"),
  ),
  discardPreparedV2Action(ids.dualOldestEmptyDiscard),
  alertAction(
    ids.dualOldestEmptyAlert,
    "Oldest Message could not be identified",
    "Apple did not provide the stable identifier required to verify its oldest-first result. Wafra erased the partial session.",
  ),
  stopAction(),
  conditionalEnd(ids.dualOldestEmptyGroup),
  findBoundedMessagesAction(ids.dualLatestProbeFind, "Latest First", 1),
  getItemFromListAction(
    ids.dualLatestProbeItem,
    actionOutput(ids.dualLatestProbeFind, "Message"),
    "First Item",
  ),
  outputPropertyTextAction(
    ids.dualLatestProbeGuid,
    "Latest Probe GUID",
    ids.dualLatestProbeItem,
    "Item from List",
    "GUID",
  ),
  conditionalTextNotEqualStart(
    ids.dualLatestProbeMismatchGroup,
    actionOutput(ids.dualLatestProbeGuid, "Latest Probe GUID"),
    outputTextToken(ids.dualNewestGuid, "Newest Extreme GUID"),
  ),
  discardPreparedV2Action(ids.dualLatestProbeMismatchDiscard),
  alertAction(
    ids.dualLatestProbeMismatchAlert,
    "Newest Message changed",
    "The newest Message changed while Wafra was preparing the first half, or Apple returned an inconsistent latest-first result. Wafra erased the partial session. Try again when Messages is idle.",
  ),
  stopAction(),
  conditionalEnd(ids.dualLatestProbeMismatchGroup),
  findBoundedMessagesAction(ids.dualOldestProbeFind, "Oldest First", 1),
  getItemFromListAction(
    ids.dualOldestProbeItem,
    actionOutput(ids.dualOldestProbeFind, "Message"),
    "First Item",
  ),
  outputPropertyTextAction(
    ids.dualOldestProbeGuid,
    "Oldest Probe GUID",
    ids.dualOldestProbeItem,
    "Item from List",
    "GUID",
  ),
  conditionalTextNotEqualStart(
    ids.dualOldestProbeMismatchGroup,
    actionOutput(ids.dualOldestProbeGuid, "Oldest Probe GUID"),
    outputTextToken(ids.dualOldestExtremeGuid, "Oldest Extreme GUID"),
  ),
  discardPreparedV2Action(ids.dualOldestProbeMismatchDiscard),
  alertAction(
    ids.dualOldestProbeMismatchAlert,
    "Oldest Message changed",
    "The oldest Message changed during the check, or Apple returned an inconsistent oldest-first result. Wafra erased the partial session. Try again when Messages is idle.",
  ),
  stopAction(),
  conditionalEnd(ids.dualOldestProbeMismatchGroup),
  conditionalTextStart(
    ids.dualSameExtremeGroup,
    actionOutput(ids.dualOldestExtremeGuid, "Oldest Extreme GUID"),
    outputTextToken(ids.dualNewestGuid, "Newest Extreme GUID"),
  ),
  conditionalStart(
    ids.dualSameExtremeCountGroup,
    actionOutput(ids.dualLatestCount, "Latest Messages Found"),
    2,
    1,
  ),
  discardPreparedV2Action(ids.dualSameExtremeDiscard),
  alertAction(
    ids.dualSameExtremeAlert,
    "Apple did not return opposite Message ends",
    "The newest-first and oldest-first results began with the same Message. Wafra erased the partial session rather than trusting an ignored sort order.",
  ),
  stopAction(),
  conditionalEnd(ids.dualSameExtremeCountGroup),
  conditionalEnd(ids.dualSameExtremeGroup),
  calculateAction(
    ids.dualCountDifference,
    "Query Count Difference",
    actionOutput(ids.dualOldestCount, "Oldest Messages Found"),
    actionOutput(ids.dualLatestCount, "Latest Messages Found"),
    "-",
  ),
  calculateAction(
    ids.dualCountDifferenceSquared,
    "Squared Query Count Difference",
    actionOutput(ids.dualCountDifference, "Query Count Difference"),
    actionOutput(ids.dualCountDifference, "Query Count Difference"),
    "×",
  ),
  conditionalStart(
    ids.dualCountMismatchGroup,
    actionOutput(
      ids.dualCountDifferenceSquared,
      "Squared Query Count Difference",
    ),
    2,
    0,
  ),
  discardPreparedV2Action(ids.dualCountMismatchDiscard),
  alertAction(
    ids.dualCountMismatchAlert,
    "Message batches did not agree",
    "Apple returned different-sized newest and oldest batches. Messages may have changed or one query may be incomplete, so Wafra erased the partial session. Try again when Messages is idle.",
  ),
  stopAction(),
  conditionalEnd(ids.dualCountMismatchGroup),
  calculateAction(
    ids.dualReverseBase,
    "Oldest Reverse Base",
    actionOutput(ids.dualOldestCount, "Oldest Messages Found"),
    1,
  ),
  repeatCountStart(
    ids.dualOldestRepeatStart,
    ids.dualOldestRepeatGroup,
    actionOutput(ids.dualOldestCount, "Oldest Messages Found"),
  ),
  calculateAction(
    ids.dualReverseIndex,
    "Oldest Reverse Index",
    actionOutput(ids.dualReverseBase, "Oldest Reverse Base"),
    namedVariable("Repeat Index"),
    "-",
  ),
  getItemFromListAction(
    ids.dualReversedItem,
    actionOutput(ids.dualOldestFind, "Message"),
    "Item At Index",
    actionOutput(ids.dualReverseIndex, "Oldest Reverse Index"),
  ),
  incrementVariable(ids.dualOldestIncrement, "Prepared Position"),
  setVariable(
    ids.dualOldestIncrementSet,
    "Prepared Position",
    actionOutput(ids.dualOldestIncrement, "Next Prepared Position"),
  ),
  ...totalOverflowActions({
    group: ids.dualOldestOverflowGroup,
    discard: ids.dualOldestDiscard,
    alert: ids.dualOldestOverflowAlert,
  }),
  outputPropertyTextAction(
    ids.dualOldestGuid,
    "Message GUID",
    ids.dualReversedItem,
    "Item from List",
    "GUID",
  ),
  outputPropertyTextAction(
    ids.dualOldestBody,
    "Message Body",
    ids.dualReversedItem,
    "Item from List",
    "Body",
  ),
  outputPropertyTextAction(
    ids.dualOldestSender,
    "Message Sender",
    ids.dualReversedItem,
    "Item from List",
    "Sender",
  ),
  conditionalTextStart(
    ids.dualOverlapGroup,
    actionOutput(ids.dualOldestGuid, "Message GUID"),
    outputTextToken(ids.dualBoundaryGuid, "Coverage Boundary GUID"),
  ),
  numberAction(ids.dualOverlapOne, "Coverage Confirmed", 1),
  setVariable(
    ids.dualOverlapSetOne,
    "Coverage Overlap",
    actionOutput(ids.dualOverlapOne, "Coverage Confirmed"),
  ),
  conditionalEnd(ids.dualOverlapGroup),
  prepareMessageV3Action({
    uuid: ids.dualOldestPrepare,
    guidUUID: ids.dualOldestGuid,
    bodyUUID: ids.dualOldestBody,
    senderUUID: ids.dualOldestSender,
    date: outputPropertyTextToken(
      ids.dualReversedItem,
      "Item from List",
      "date",
    ),
  }),
  repeatCountEnd(ids.dualOldestRepeatEnd, ids.dualOldestRepeatGroup),
  nothingAction(ids.dualOldestRelease),
  conditionalStart(
    ids.dualNoCoverageGroup,
    namedVariable("Coverage Overlap"),
    1,
    0,
  ),
  discardPreparedV2Action(ids.dualNoCoverageDiscard),
  alertAction(
    ids.dualNoCoverageAlert,
    "History coverage could not be verified",
    "The two 1,500-message halves did not overlap. This iPhone may retain 3,000 or more Messages, so Wafra erased the partial session instead of knowingly importing a bounded partial history.",
  ),
  stopAction(),
  conditionalEnd(ids.dualNoCoverageGroup),
  {
    WFWorkflowActionIdentifier: IMPORT_V2_INTENT,
    WFWorkflowActionParameters: {
      UUID: ids.v2FinalImport,
      AppIntentDescriptor: appIntentDescriptor(
        "ImportWafraPreparedHistoryV2Intent",
      ),
      sessionId: outputTextToken(ids.sessionId, "Session ID"),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.urlencode",
    WFWorkflowActionParameters: {
      UUID: ids.encoded,
      WFEncodeMode: "Encode",
      WFInput: outputTextToken(ids.sessionId, "Session ID"),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.url",
    WFWorkflowActionParameters: {
      UUID: ids.url,
      WFURLActionURL: textToken("wafra://import-sms?history=\ufffc", {
        "{27, 1}": actionOutputValue(ids.encoded, "URL Encoded Text"),
      }),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.openurl",
    WFWorkflowActionParameters: { WFInput: actionOutput(ids.url, "URL") },
  },
  stopAction(),
];

const buildProcessingActions = () => [
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.count",
    WFWorkflowActionParameters: {
      UUID: ids.found,
      CustomOutputName: "Messages Found",
      WFCountType: "Items",
      Input: actionOutput(ids.find, "Message"),
      WFInput: actionOutput(ids.find, "Message"),
    },
  },
  conditionalStart(
    ids.zeroGroup,
    actionOutput(ids.found, "Messages Found"),
    1,
    0,
  ),
  alertAction(
    ids.zeroAlert,
    "No Messages found",
    "No retained Messages matched the selected dates. Nothing was imported.",
  ),
  stopAction(),
  conditionalEnd(ids.zeroGroup),
  conditionalStart(
    ids.tooManyGroup,
    actionOutput(ids.found, "Messages Found"),
    2,
    10000,
  ),
  alertAction(
    ids.tooManyAlert,
    "Too many Messages",
    "Use a shorter date range. Wafra accepts at most 10,000 Messages per import.",
  ),
  stopAction(),
  conditionalEnd(ids.tooManyGroup),
  alertAction(
    ids.confirmation,
    "Review before import",
    textWithOutput(
      "Wafra found ",
      " Messages. Continue to prepare them locally for review?",
      ids.found,
      "Messages Found",
    ),
    true,
  ),
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.number.random",
    WFWorkflowActionParameters: {
      UUID: ids.randomA,
      WFRandomNumberMinimum: 0,
      WFRandomNumberMaximum: 999999999999999,
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.number.random",
    WFWorkflowActionParameters: {
      UUID: ids.randomB,
      WFRandomNumberMinimum: 0,
      WFRandomNumberMaximum: 999999999999999,
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
    WFWorkflowActionParameters: {
      UUID: ids.sessionId,
      CustomOutputName: "Session ID",
      WFTextActionText: textToken("WAFRA-\ufffc-\ufffc", {
        "{6, 1}": actionOutputValue(ids.randomA, "Random Number"),
        "{8, 1}": actionOutputValue(ids.randomB, "Random Number"),
      }),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
    WFWorkflowActionParameters: {
      UUID: ids.repeatStart,
      GroupingIdentifier: ids.repeatGroup,
      WFControlFlowMode: 0,
      WFInput: actionOutput(ids.find, "Message"),
    },
  },
  repeatPropertyTextAction(ids.messageGuidText, "Message GUID", "GUID"),
  repeatPropertyTextAction(ids.messageBodyText, "Message Body", "Body"),
  repeatPropertyTextAction(ids.messageSenderText, "Message Sender", "Sender"),
  {
    WFWorkflowActionIdentifier: PREPARE_INTENT,
    WFWorkflowActionParameters: {
      UUID: ids.prepare,
      AppIntentDescriptor: appIntentDescriptor(
        "PrepareWafraHistoryMessageIntent",
      ),
      sessionId: outputTextToken(ids.sessionId, "Session ID"),
      found: actionOutput(ids.found, "Messages Found"),
      position: namedVariable("Repeat Index"),
      messageGUID: outputTextToken(ids.messageGuidText, "Message GUID"),
      body: outputTextToken(ids.messageBodyText, "Message Body"),
      sender: outputTextToken(ids.messageSenderText, "Message Sender"),
      date: namedVariableTextToken("Repeat Item", [property("date")]),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
    WFWorkflowActionParameters: {
      UUID: ids.repeatEnd,
      GroupingIdentifier: ids.repeatGroup,
      WFControlFlowMode: 2,
    },
  },
  {
    WFWorkflowActionIdentifier: IMPORT_INTENT,
    WFWorkflowActionParameters: {
      UUID: ids.finalImport,
      AppIntentDescriptor: appIntentDescriptor(
        "ImportWafraPreparedHistoryIntent",
      ),
      sessionId: outputTextToken(ids.sessionId, "Session ID"),
      found: actionOutput(ids.found, "Messages Found"),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.urlencode",
    WFWorkflowActionParameters: {
      UUID: ids.encoded,
      WFEncodeMode: "Encode",
      WFInput: outputTextToken(ids.sessionId, "Session ID"),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.url",
    WFWorkflowActionParameters: {
      UUID: ids.url,
      WFURLActionURL: textToken("wafra://import-sms?history=\ufffc", {
        "{27, 1}": actionOutputValue(ids.encoded, "URL Encoded Text"),
      }),
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.openurl",
    WFWorkflowActionParameters: { WFInput: actionOutput(ids.url, "URL") },
  },
  stopAction(),
];

const buildActions = ({ messageLimit, smoke }) =>
  smoke
    ? [...buildSmokePreamble({ messageLimit }), ...buildProcessingActions()]
    : buildProductionV2Actions();

export const buildHistoryShortcut = ({ messageLimit, smoke = false } = {}) => {
  const resolvedMessageLimit = smoke
    ? (messageLimit ?? 50)
    : (messageLimit ?? 1500);
  validateMessageLimit(resolvedMessageLimit, smoke);
  if (typeof smoke !== "boolean") throw new Error("smoke must be a Boolean");
  return {
    WFWorkflowName: "Wafra History Import",
    WFWorkflowMinimumClientVersionString: "4042",
    WFWorkflowMinimumClientVersion: 4042,
    WFWorkflowIcon: {
      WFWorkflowIconStartColor: -314141441,
      WFWorkflowIconGlyphNumber: 61440,
    },
    WFWorkflowClientVersion: "4042.0.2.2",
    WFWorkflowHasOutputFallback: false,
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: ["WFWorkflowTypeShowInSearch"],
    WFQuickActionSurfaces: [],
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowActions: buildActions({
      messageLimit: resolvedMessageLimit,
      smoke,
    }),
  };
};

const isDeepEqual = isDeepStrictEqual;

export function verifyHistoryShortcutGraph(shortcut) {
  const fail = (message) => {
    throw new Error(message);
  };
  const expect = (condition, message) => {
    if (!condition) fail(message);
  };
  const actions = shortcut?.WFWorkflowActions;
  const parameters = (index) =>
    actions[index]?.WFWorkflowActionParameters ?? {};
  const identifier = (index) => actions[index]?.WFWorkflowActionIdentifier;
  const candidateFind = Array.isArray(actions)
    ? actions.find(
        (action) => action?.WFWorkflowActionIdentifier === FIND_MESSAGES,
      )
    : undefined;
  const isSmoke =
    candidateFind?.WFWorkflowActionParameters?.WFContentItemLimitEnabled ===
      true &&
    candidateFind?.WFWorkflowActionParameters?.WFContentItemLimitNumber === 50;
  expect(
    isDeepEqual(
      shortcut,
      isSmoke ? buildHistoryShortcut({ smoke: true }) : buildHistoryShortcut(),
    ),
    `artifact is not the exact ${isSmoke ? "smoke" : "production"} graph`,
  );
  if (!isSmoke) return true;
  const output = (value) => value?.Value ?? value;
  const assertActionOutput = (value, uuid, name, message) => {
    const bound = output(value);
    expect(
      value?.WFSerializationType === "WFTextTokenAttachment",
      `${message} wrapper is wrong`,
    );
    expect(
      bound?.Type === "ActionOutput" &&
        bound?.OutputUUID === uuid &&
        bound?.OutputName === name,
      message,
    );
  };
  const assertTextOutput = (value, range, uuid, name, message) => {
    const bound = value?.Value?.attachmentsByRange?.[range];
    expect(
      value?.WFSerializationType === "WFTextTokenString",
      `${message} wrapper is wrong`,
    );
    expect(
      bound?.Type === "ActionOutput" &&
        bound?.OutputUUID === uuid &&
        bound?.OutputName === name,
      message,
    );
  };
  const assertScalarTextOutput = (value, uuid, name, message) => {
    expect(
      value?.Value?.string === "\ufffc" &&
        isDeepEqual(Object.keys(value?.Value?.attachmentsByRange ?? {}), [
          "{0, 1}",
        ]),
      `${message} wrapper is wrong`,
    );
    assertTextOutput(value, "{0, 1}", uuid, name, message);
  };
  const assertNamedVariable = (value, name, propertyName, message) => {
    const bound = output(value);
    expect(
      value?.WFSerializationType === "WFTextTokenAttachment",
      `${message} wrapper is wrong`,
    );
    expect(bound?.Type === "Variable" && bound?.VariableName === name, message);
    if (propertyName === undefined) {
      expect(!Object.hasOwn(bound ?? {}, "Aggrandizements"), message);
      return;
    }
    expect(
      Array.isArray(bound?.Aggrandizements) &&
        bound.Aggrandizements.length === 1 &&
        bound.Aggrandizements[0]?.Type === "WFPropertyVariableAggrandizement" &&
        bound.Aggrandizements[0]?.PropertyName === propertyName,
      message,
    );
  };
  const assertNamedTextVariable = (value, name, propertyName, message) => {
    const bound = value?.Value?.attachmentsByRange?.["{0, 1}"];
    expect(
      value?.WFSerializationType === "WFTextTokenString" &&
        value?.Value?.string === "\ufffc" &&
        Object.keys(value?.Value?.attachmentsByRange ?? {}).length === 1,
      `${message} wrapper is wrong`,
    );
    expect(bound?.Type === "Variable" && bound?.VariableName === name, message);
    expect(
      Array.isArray(bound?.Aggrandizements) &&
        bound.Aggrandizements.length === 1 &&
        bound.Aggrandizements[0]?.Type === "WFPropertyVariableAggrandizement" &&
        bound.Aggrandizements[0]?.PropertyName === propertyName,
      message,
    );
  };
  const assertDescriptor = (value, appIntentIdentifier, message) => {
    expect(
      isDeepEqual(value, {
        TeamIdentifier: APP_TEAM_ID,
        BundleIdentifier: APP_BUNDLE_ID,
        Name: "Wafra",
        AppIntentIdentifier: appIntentIdentifier,
      }),
      message,
    );
  };

  expect(
    shortcut?.WFWorkflowName === "Wafra History Import",
    "wrong Shortcut name",
  );
  expect(
    shortcut?.WFWorkflowHasShortcutInputVariables === false,
    "external input is enabled",
  );
  expect(
    Array.isArray(shortcut?.WFWorkflowInputContentItemClasses) &&
      shortcut.WFWorkflowInputContentItemClasses.length === 0,
    "external input is accepted",
  );
  expect(
    Array.isArray(shortcut?.WFWorkflowImportQuestions) &&
      shortcut.WFWorkflowImportQuestions.length === 0,
    "import questions are prohibited",
  );
  expect(
    shortcut?.WFWorkflowHasOutputFallback === false &&
      Array.isArray(shortcut?.WFWorkflowOutputContentItemClasses) &&
      shortcut.WFWorkflowOutputContentItemClasses.length === 0,
    "Shortcut output is enabled",
  );
  expect(Array.isArray(actions), "actions missing");

  const allowed = new Set([
    "is.workflow.actions.alert",
    "is.workflow.actions.date",
    "is.workflow.actions.adjustdate",
    FIND_MESSAGES,
    "is.workflow.actions.count",
    "is.workflow.actions.conditional",
    "is.workflow.actions.exit",
    "is.workflow.actions.number.random",
    "is.workflow.actions.gettext",
    "is.workflow.actions.repeat.each",
    PREPARE_INTENT,
    IMPORT_INTENT,
    "is.workflow.actions.urlencode",
    "is.workflow.actions.url",
    "is.workflow.actions.openurl",
  ]);
  const explicitlyForbidden = new Set([
    "app.wafra.ios.BeginWafraHistoryImportIntent",
    "app.wafra.ios.StageWafraMessageHistoryIntent",
    "app.wafra.ios.FinishWafraHistoryImportIntent",
    "app.wafra.ios.ImportWafraMessageHistoryIntent",
  ]);
  for (const action of actions) {
    const candidate = action?.WFWorkflowActionIdentifier;
    if (explicitlyForbidden.has(candidate))
      fail(`forbidden action ${candidate}`);
    if (!allowed.has(candidate))
      fail(`forbidden action ${candidate ?? "<missing>"}`);
  }

  expect(
    identifier(0) === "is.workflow.actions.alert",
    "local disclosure is missing",
  );
  expect(
    parameters(0).WFAlertActionTitle === "Import bank alert history" &&
      parameters(0).WFAlertActionCancelButtonShown === true &&
      /locally.*Nothing is uploaded\./.test(
        parameters(0).WFAlertActionMessage ?? "",
      ),
    "local disclosure is incomplete",
  );
  expect(
    identifier(1) === "is.workflow.actions.date",
    "current Date is missing",
  );
  expect(parameters(1).UUID === ids.now, "current Date output changed");

  const dateSteps = [
    [2, ids.todayStart, ids.now, "Date", "Get Start of Day", undefined],
    [
      3,
      ids.minusThirtyDays,
      ids.todayStart,
      "Today Start",
      "Subtract",
      [29, "days"],
    ],
    [
      4,
      ids.startBoundary,
      ids.minusThirtyDays,
      "First Included Day",
      "Subtract",
      [1, "seconds"],
    ],
    [5, ids.tomorrowBase, ids.now, "Date", "Get Start of Day", undefined],
    [
      6,
      ids.exclusiveEnd,
      ids.tomorrowBase,
      "Tomorrow Base",
      "Add",
      [1, "days"],
    ],
  ];
  for (const [
    index,
    uuid,
    sourceUUID,
    sourceName,
    operation,
    duration,
  ] of dateSteps) {
    expect(
      identifier(index) === "is.workflow.actions.adjustdate",
      "date boundary action is missing",
    );
    expect(parameters(index).UUID === uuid, "date boundary output changed");
    assertActionOutput(
      parameters(index).WFDate,
      sourceUUID,
      sourceName,
      "date boundary dataflow is wrong",
    );
    expect(
      parameters(index).WFAdjustOperation === operation,
      "date boundary operation is wrong",
    );
    if (duration) {
      expect(
        parameters(index).WFDuration?.Value?.Magnitude === duration[0] &&
          parameters(index).WFDuration?.Value?.Unit === duration[1],
        "date boundary duration is wrong",
      );
    }
  }

  expect(identifier(7) === FIND_MESSAGES, "expected exactly one Find Message");
  expect(
    actions.filter(
      (action) => action.WFWorkflowActionIdentifier === FIND_MESSAGES,
    ).length === 1,
    "expected exactly one Find Message",
  );
  const templates =
    parameters(7).WFContentItemFilter?.Value?.WFActionParameterFilterTemplates;
  expect(
    Array.isArray(templates) && templates.length === 2,
    "Find Message must use date-only filters",
  );
  expect(
    templates[0]?.Property === "date" &&
      templates[0]?.Operator === 2 &&
      templates[1]?.Property === "date" &&
      templates[1]?.Operator === 0,
    "date filters are reversed or unsafe",
  );
  assertActionOutput(
    templates[0]?.Values?.Date,
    ids.startBoundary,
    "Start Boundary",
    "start date filter is wrong",
  );
  assertActionOutput(
    templates[1]?.Values?.Date,
    ids.exclusiveEnd,
    "Exclusive End",
    "end date filter is wrong",
  );
  expect(
    parameters(7).WFContentItemSortProperty === "date" &&
      parameters(7).WFContentItemSortOrder === "Latest First",
    "Message query must use latest-first order",
  );
  expect(
    parameters(7).WFContentItemLimitEnabled === true &&
      parameters(7).WFContentItemLimitNumber === 50,
    "invalid recent-message limit",
  );

  expect(
    identifier(8) === "is.workflow.actions.count",
    "Message count is missing",
  );
  assertActionOutput(
    parameters(8).WFInput,
    ids.find,
    "Message",
    "Message count dataflow is wrong",
  );

  const assertGuard = (startIndex, group, condition, number, label) => {
    expect(
      identifier(startIndex) === "is.workflow.actions.conditional",
      `${label} is missing`,
    );
    const start = parameters(startIndex);
    expect(
      start.GroupingIdentifier === group &&
        start.WFControlFlowMode === 0 &&
        start.WFCondition === condition &&
        start.WFNumberValue === number,
      `${label} comparison is wrong`,
    );
    assertActionOutput(
      start.WFInput?.Variable,
      ids.found,
      "Messages Found",
      `${label} count dataflow is wrong`,
    );
    expect(
      identifier(startIndex + 1) === "is.workflow.actions.alert",
      `${label} alert is missing`,
    );
    expect(
      identifier(startIndex + 2) === "is.workflow.actions.exit",
      `${label} must stop`,
    );
    expect(
      identifier(startIndex + 3) === "is.workflow.actions.conditional" &&
        parameters(startIndex + 3).GroupingIdentifier === group &&
        parameters(startIndex + 3).WFControlFlowMode === 2,
      `${label} end marker is wrong`,
    );
  };
  assertGuard(9, ids.zeroGroup, 1, 0, "zero-result guard");
  assertGuard(13, ids.tooManyGroup, 2, 10000, "over-limit guard");

  expect(
    identifier(17) === "is.workflow.actions.alert",
    "confirmation is missing",
  );
  const confirmation = parameters(17).WFAlertActionMessage;
  expect(
    confirmation?.Value?.string ===
      "Wafra found \ufffc Messages. Continue to prepare them locally for review?" &&
      parameters(17).WFAlertActionCancelButtonShown === true,
    "confirmation count text is wrong",
  );
  assertTextOutput(
    confirmation,
    "{12, 1}",
    ids.found,
    "Messages Found",
    "confirmation count is not exact",
  );

  for (const [index, uuid] of [
    [18, ids.randomA],
    [19, ids.randomB],
  ]) {
    expect(
      identifier(index) === "is.workflow.actions.number.random",
      "random session component is missing",
    );
    expect(
      parameters(index).UUID === uuid &&
        parameters(index).WFRandomNumberMinimum === 0 &&
        parameters(index).WFRandomNumberMaximum === 999999999999999,
      "random session component is unsafe",
    );
  }
  expect(
    identifier(20) === "is.workflow.actions.gettext",
    "Session ID Text is missing",
  );
  const sessionText = parameters(20).WFTextActionText;
  expect(
    parameters(20).UUID === ids.sessionId &&
      parameters(20).CustomOutputName === "Session ID" &&
      sessionText?.Value?.string === "WAFRA-\ufffc-\ufffc",
    "Session ID must be simple WAFRA random Text",
  );
  assertTextOutput(
    sessionText,
    "{6, 1}",
    ids.randomA,
    "Random Number",
    "first random Session ID component is wrong",
  );
  assertTextOutput(
    sessionText,
    "{8, 1}",
    ids.randomB,
    "Random Number",
    "second random Session ID component is wrong",
  );

  const prepareIndexes = actions.flatMap((action, index) =>
    action.WFWorkflowActionIdentifier === PREPARE_INTENT ? [index] : [],
  );
  expect(prepareIndexes.length === 1, "expected exactly one prepare action");
  const importIndexes = actions.flatMap((action, index) =>
    action.WFWorkflowActionIdentifier === IMPORT_INTENT ? [index] : [],
  );
  expect(importIndexes.length === 1, "expected exactly one final import");
  const openIndexes = actions.flatMap((action, index) =>
    action.WFWorkflowActionIdentifier === "is.workflow.actions.openurl"
      ? [index]
      : [],
  );
  expect(
    openIndexes.length === 1 && openIndexes[0] > importIndexes[0],
    "history deep link must open after final import",
  );
  const repeatIndexes = actions.flatMap((action, index) =>
    action.WFWorkflowActionIdentifier === "is.workflow.actions.repeat.each"
      ? [index]
      : [],
  );
  expect(repeatIndexes.length === 2, "expected one Repeat Each block");
  const [repeatStartIndex, repeatEndIndex] = repeatIndexes;
  expect(
    parameters(repeatStartIndex).GroupingIdentifier === ids.repeatGroup &&
      parameters(repeatStartIndex).WFControlFlowMode === 0 &&
      parameters(repeatEndIndex).GroupingIdentifier === ids.repeatGroup &&
      parameters(repeatEndIndex).WFControlFlowMode === 2,
    "Repeat Each markers are mismatched",
  );
  assertActionOutput(
    parameters(repeatStartIndex).WFInput,
    ids.find,
    "Message",
    "Repeat Each must use every found Message",
  );

  const assertRepeatPropertyTextAction = (
    index,
    uuid,
    customOutputName,
    propertyName,
  ) => {
    expect(
      identifier(index) === "is.workflow.actions.gettext" &&
        parameters(index).UUID === uuid &&
        parameters(index).CustomOutputName === customOutputName,
      `${customOutputName} extraction action is missing`,
    );
    const token = parameters(index).WFTextActionText;
    const bound = token?.Value?.attachmentsByRange?.["{0, 1}"];
    expect(
      token?.WFSerializationType === "WFTextTokenString" &&
        token?.Value?.string === "\ufffc" &&
        Object.keys(token?.Value?.attachmentsByRange ?? {}).length === 1 &&
        bound?.Type === "Variable" &&
        bound?.VariableName === "Repeat Item" &&
        isDeepEqual(bound?.Aggrandizements, [
          {
            Type: "WFPropertyVariableAggrandizement",
            PropertyName: propertyName,
          },
          {
            Type: "WFCoercionVariableAggrandizement",
            CoercionItemClass: "WFStringContentItem",
          },
        ]),
      `${customOutputName} extraction dataflow is wrong`,
    );
  };
  assertRepeatPropertyTextAction(
    repeatStartIndex + 1,
    ids.messageGuidText,
    "Message GUID",
    "GUID",
  );
  assertRepeatPropertyTextAction(
    repeatStartIndex + 2,
    ids.messageBodyText,
    "Message Body",
    "Body",
  );
  assertRepeatPropertyTextAction(
    repeatStartIndex + 3,
    ids.messageSenderText,
    "Message Sender",
    "Sender",
  );

  expect(
    repeatStartIndex < prepareIndexes[0] && prepareIndexes[0] < repeatEndIndex,
    "prepare action must be inside Repeat Each",
  );
  const prepare = parameters(prepareIndexes[0]);
  expect(
    isDeepEqual(
      Object.keys(prepare).sort(),
      [
        "AppIntentDescriptor",
        "UUID",
        "body",
        "date",
        "found",
        "messageGUID",
        "position",
        "sender",
        "sessionId",
      ].sort(),
    ),
    "prepare parameters are not exact",
  );
  assertDescriptor(
    prepare.AppIntentDescriptor,
    "PrepareWafraHistoryMessageIntent",
    "prepare descriptor is wrong",
  );
  assertScalarTextOutput(
    prepare.sessionId,
    ids.sessionId,
    "Session ID",
    "prepare must use the same Session ID",
  );
  assertActionOutput(
    prepare.found,
    ids.found,
    "Messages Found",
    "prepare must use the exact found count",
  );
  assertNamedVariable(
    prepare.position,
    "Repeat Index",
    undefined,
    "prepare position must use Repeat Index",
  );
  assertScalarTextOutput(
    prepare.messageGUID,
    ids.messageGuidText,
    "Message GUID",
    "prepare must use the extracted Message GUID",
  );
  assertScalarTextOutput(
    prepare.body,
    ids.messageBodyText,
    "Message Body",
    "prepare must use the extracted Message Body",
  );
  assertScalarTextOutput(
    prepare.sender,
    ids.messageSenderText,
    "Message Sender",
    "prepare must use the extracted Message Sender",
  );
  assertNamedTextVariable(
    prepare.date,
    "Repeat Item",
    "date",
    "prepare must use the Repeat Item Date property",
  );

  expect(
    importIndexes[0] > repeatEndIndex,
    "final import must be after Repeat Each",
  );
  const finalImport = parameters(importIndexes[0]);
  expect(
    isDeepEqual(
      Object.keys(finalImport).sort(),
      ["AppIntentDescriptor", "UUID", "found", "sessionId"].sort(),
    ),
    "final import parameters are not exact",
  );
  assertDescriptor(
    finalImport.AppIntentDescriptor,
    "ImportWafraPreparedHistoryIntent",
    "final import descriptor is wrong",
  );
  assertScalarTextOutput(
    finalImport.sessionId,
    ids.sessionId,
    "Session ID",
    "final import must use the same Session ID",
  );
  assertActionOutput(
    finalImport.found,
    ids.found,
    "Messages Found",
    "final import must use the exact found count",
  );

  expect(
    identifier(28) === "is.workflow.actions.urlencode",
    "Session ID URL encoding is missing",
  );
  expect(parameters(28).WFEncodeMode === "Encode", "URL Encode mode is wrong");
  assertScalarTextOutput(
    parameters(28).WFInput,
    ids.sessionId,
    "Session ID",
    "URL encoding must use the same Session ID",
  );
  expect(
    identifier(29) === "is.workflow.actions.url",
    "history deep link is missing",
  );
  const deepLink = parameters(29).WFURLActionURL;
  expect(
    deepLink?.Value?.string === "wafra://import-sms?history=\ufffc" &&
      Object.keys(deepLink?.Value?.attachmentsByRange ?? {}).length === 1,
    "expected exact history deep link",
  );
  assertTextOutput(
    deepLink,
    "{27, 1}",
    ids.encoded,
    "URL Encoded Text",
    "history deep link must use encoded Session ID",
  );
  expect(
    identifier(30) === "is.workflow.actions.openurl",
    "history deep link must open after final import",
  );
  assertActionOutput(
    parameters(30).WFInput,
    ids.url,
    "URL",
    "open URL dataflow is wrong",
  );
  expect(
    identifier(31) === "is.workflow.actions.exit",
    "Shortcut must stop without output",
  );
  expect(actions.length === 32, "expected exact 32-action graph");

  const serialized = JSON.stringify(shortcut);
  expect(
    !/https?:|wafra-relay|authorizationSecret|GUIDs|Bodies|Dates/.test(
      serialized,
    ),
    "graph contains forbidden source/network data",
  );
  return true;
}

const parseCLI = (args) => {
  let outputPath = "/tmp/WafraHistoryImport.json";
  let messageLimit = 1500;
  let smoke = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--limit") {
      messageLimit = Number(args[index + 1] ?? "");
      smoke = true;
      index += 1;
      continue;
    }
    if (args[index].startsWith("--"))
      throw new Error(`unknown option ${args[index]}`);
    outputPath = args[index];
  }
  validateMessageLimit(messageLimit, smoke);
  return { outputPath: resolve(outputPath), messageLimit, smoke };
};

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const { outputPath, messageLimit, smoke } = parseCLI(process.argv.slice(2));
  const shortcut = buildHistoryShortcut({ messageLimit, smoke });
  verifyHistoryShortcutGraph(shortcut);
  await writeFile(outputPath, `${JSON.stringify(shortcut, null, 2)}\n`, "utf8");
  console.log(outputPath);
}
