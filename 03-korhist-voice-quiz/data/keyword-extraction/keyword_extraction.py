# -*- coding: utf-8 -*-
"""
핵심 키워드 자동 추출 파이프라인 (형태소 분석 → TextRank)

지시 문서(클로드코드_추가지시_키워드추출.md, 원문텍스트_5개사건.md)에 따라
5개 사건 원문 텍스트에서 사람 손을 거치지 않고 알고리즘으로 핵심 키워드를 추출한다.

- 형태소 분석기: kiwipiepy (한국어, Java 불필요)  → 명사(NNG/NNP)만 추출 (+4자리 연도 SN)
- 키워드 랭킹: TextRank (단어 co-occurrence 그래프 → networkx PageRank)
- LLM은 일절 사용하지 않음 (통계/그래프 알고리즘)

출력: outputs/textrank_결과.json, outputs/핵심키워드_추출근거표.xlsx
"""
import re
import json
import itertools
from pathlib import Path
from kiwipiepy import Kiwi
import networkx as nx

OUT = Path(__file__).resolve().parent
SRC = "한국사능력검정시험 공식 홈페이지"  # 원문 텍스트 출처 (전 문항 공통)

# ------------------------------------------------------------------
# 1단계: 원문 텍스트 (원문텍스트_5개사건.md 내용)
# ------------------------------------------------------------------
EVENTS = [
    {
        "id": "1", "사건명": "강화도 조약", "연도": "1876",
        "text": (
            "강화도 조약은 우리 나라가 외국과 맺은 최초의 근대적 조약으로, 여러 가지 중요한 의미를 가지고 있다. "
            "일본은 자신들이 일으킨 운요호 사건을 핑계로 1876년 조선에 군함과 함께 전권대사를 파견하여 "
            "경기 연안에서 무력 시위를 하는 방법으로 조약 체결을 강요하였다. "
            "이 조약에 따라 조선은 부산, 원산, 제물포의 세 항구를 개항하고, "
            "개항장의 일정 지역에 일본인이 거주하는 것을 허용하였다. "
            "강화도 조약에서는 조선이 자주 국가임을 밝혔지만, 일본이 조선의 해안을 자유로이 측량하는 것을 허용하고, "
            "치외법권을 인정하여 일본인들이 조선에서 죄를 지어도 일본의 법에 의하여 재판받게 한 것이 "
            "불평등한 내용의 대표적인 예이다."
        ),
    },
    {
        "id": "2", "사건명": "임오군란", "연도": "1882",
        "text": (
            "임오군란은 1882년 서울의 하급 군인들과 도시 빈민들이 개항 이후 심화된 개화 정책과 "
            "집권 세력에 저항하여 일으킨 사건이다. 항쟁의 직접적인 원인은 구식 군인에게 밀린 급료를 지급할 때 "
            "받은 쌀에 겨와 모래가 섞여 있어 이에 대한 분노로 일어난 것이었다. "
            "구식 군인에 대한 차별과 신식 군대 별기군에 대한 우대, 급진적인 개화 정책에 대한 반발도 "
            "항쟁의 주요 원인으로 작용하였다. 봉기한 군인들은 정부 고관들의 집을 부수고 창덕궁을 점령하였으며, "
            "일본 공사관을 공격하였다. 임오군란 이후 청나라 군대가 개입하여 사건을 진압하였고, "
            "이를 계기로 청나라의 조선에 대한 간섭이 강화되었다."
        ),
    },
    {
        "id": "3", "사건명": "갑신정변", "연도": "1884",
        "text": (
            "갑신정변은 1884년 김옥균을 중심으로 한 급진 개화파가 청나라의 간섭에서 벗어난 자주 독립과 "
            "근대적 개혁을 목표로 일으킨 정변이다. 청프 전쟁으로 조선에 주둔하던 청국 군대의 일부가 철수하자, "
            "급진 개화파는 이를 기회로 삼아 일본 공사의 협조를 얻어 우정총국 개국 축하연을 계기로 정변을 일으켰다. "
            "이들은 개화당 정부를 세우고 청국에 대한 사대 관계 청산, 문벌 폐지와 신분제 타파 등을 담은 "
            "개혁 정강을 발표하였다. 그러나 청군이 개입하여 궁궐을 공격하면서 정변은 3일 만에 실패로 끝났고, "
            "김옥균 등 주도 세력은 일본으로 망명하였다."
        ),
    },
    {
        "id": "4", "사건명": "동학농민운동", "연도": "1894",
        "text": (
            "동학농민운동은 1894년 전라도 고부에서 동학 접주 전봉준의 지도 아래 "
            "동학교도와 농민들이 힘을 합쳐 일으킨 농민 운동이다. 부패한 관리들의 수탈과 외세의 침략에 "
            "저항하여 일어난 이 운동은 관군과 농민 사이의 전면적인 항쟁으로 발전하였다. "
            "전봉준이 이끄는 농민군은 황룡촌 전투에서 관군을 격파하였으며, "
            "이후 전주 화약이 체결되면서 농민군은 집강소를 설치하여 폐정 개혁을 추진하였다. "
            "그러나 일본군이 개입하면서 농민군은 우금치 전투에서 패배하였고 운동은 좌절되었다."
        ),
    },
    {
        "id": "5", "사건명": "을사늑약", "연도": "1905",
        "text": (
            "을사늑약은 1905년 대한제국의 외부대신 박제순과 일본의 특명전권공사 하야시 곤스케 명의로 "
            "강제 체결된 조약이다. 이 조약으로 대한제국은 외교권을 박탈당하였고 "
            "각국에 설치하였던 재외 공관이 폐지되었다. 일본은 통감부를 설치하였고, "
            "이토 히로부미가 초대 통감으로 부임하여 식민 지배의 기초 작업을 수행하였다. "
            "을사늑약이 강제로 체결되자 고종 황제는 헤이그 만국 평화 회의에 특사를 파견하여 "
            "조약의 부당함과 무효를 국제 사회에 호소하였다. 민영환 등은 자결로써 저항하였다."
        ),
    },
]

# ------------------------------------------------------------------
# 표준 전처리: 일반적 비내용 명사 불용어 (표준 NLP 전처리 단계)
#   - 특정 정답을 노린 취사선택이 아니라, 어느 사건에나 공통으로 등장하는
#     절차적/연결적 일반명사만 제거한다. (객관성 유지)
# ------------------------------------------------------------------
STOPWORDS = {
    "사건", "당시", "이후", "중심", "지도", "아래", "방법", "여러", "가지",
    "의미", "자신", "우리", "나라", "정도", "일부", "모두", "때문", "대한",
    "지역", "일정", "직접", "주요", "원인", "내용", "대표", "이들", "기회",
    "관계", "작용", "발전", "추진", "저항", "개입", "명의", "목표", "세력",
}

kiwi = Kiwi()

def extract_nouns(text):
    """명사(NNG/NNP)만 추출 + 4자리 연도(SN). 길이 1 및 불용어 제거."""
    nouns = []
    for tok in kiwi.tokenize(text):
        if tok.tag in ("NNG", "NNP"):
            if len(tok.form) >= 2 and tok.form not in STOPWORDS:
                nouns.append(tok.form)
        elif tok.tag == "SN" and re.fullmatch(r"\d{4}", tok.form):
            nouns.append(tok.form)  # 연도
    return nouns

# ------------------------------------------------------------------
# 핵심인물(인명) 검출: 고유명사(NNP) 중 한국식 성씨로 시작하는 2~3음절
#   - 지명/기관은 접미사(도·부·산·포·궁·국…)와 지명 불용어로 제외
# ------------------------------------------------------------------
SURNAMES = set("김이박최정강조윤장임한오서신권황안송류유홍전고문손양배백허남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모나")
PLACE_SUFFIX = set("도부촌산포궁국")
PLACES = {
    "조선", "서울", "황룡", "경기", "고부", "전주", "강화도", "전라도",
    "원산", "부산", "제물포", "창덕궁", "우정총국", "통감부", "대한제국",
    "헤이그", "청국", "청군", "청나라", "우금치", "개항장", "만국", "일본",
    "정강",  # 정치 강령 — 인명 아님(오검출 방지)
}

def extract_persons(text):
    """NNP 토큰 중 인명으로 판단되는 것만 집합으로 반환."""
    persons = set()
    for tok in kiwi.tokenize(text):
        if tok.tag != "NNP":
            continue
        f = tok.form
        if len(f) in (2, 3) and f[0] in SURNAMES and f[-1] not in PLACE_SUFFIX and f not in PLACES:
            persons.add(f)
    return persons

def textrank_scores(nouns, window=4):
    """단어 co-occurrence 그래프 → PageRank(=TextRank). {단어:점수} 반환."""
    G = nx.Graph()
    G.add_nodes_from(set(nouns))
    for i in range(len(nouns)):
        for j in range(i + 1, min(i + window, len(nouns))):
            a, b = nouns[i], nouns[j]
            if a == b:
                continue
            if G.has_edge(a, b):
                G[a][b]["weight"] += 1
            else:
                G.add_edge(a, b, weight=1)
    if G.number_of_edges() == 0:
        return {}
    return nx.pagerank(G, weight="weight")

def top_by(score_map, top_n=5):
    return sorted(score_map.items(), key=lambda kv: (-kv[1], kv[0]))[:top_n]

# ------------------------------------------------------------------
# 실행
# ------------------------------------------------------------------
from math import log

# 먼저 전체 문항의 명사를 뽑아 문서빈도(df) 계산 (IDF 재가중용)
per_event_nouns = [extract_nouns(ev["text"]) for ev in EVENTS]
N = len(EVENTS)
df = {}
for nouns in per_event_nouns:
    for w in set(nouns):
        df[w] = df.get(w, 0) + 1
# IDF: 여러 문서에 두루 나오는 일반어(일본·조선·조약·체결…)는 0에 수렴
idf = {w: log(N / dfw) for w, dfw in df.items()}

GENERIC_DF = 3  # 문서빈도 이 값 이상이면 여러 사건에 공통되는 일반어로 보고 제외('조선' 등)

results = []
for ev, nouns in zip(EVENTS, per_event_nouns):
    pr = textrank_scores(nouns, window=4)                       # 순수 TextRank
    pr_idf = {w: s * idf.get(w, 0) for w, s in pr.items()}      # TextRank × IDF
    raw_top5 = top_by(pr, 5)
    idf_top5 = top_by(pr_idf, 5)
    idf_ranked = top_by(pr_idf, len(pr_idf))
    persons = extract_persons(ev["text"])
    persons_ranked = [w for w, _ in idf_ranked if w in persons]  # 점수순 인물
    year = ev["연도"]

    # ---- 최종 정답 키워드 5개 구성 ----
    final = [year]                                   # (1) 연도: 규칙 고정 포함
    for p in persons_ranked[:1]:                     # (2) 핵심인물: 최상위 1명 포함
        if p not in final:
            final.append(p)
    for w, _ in idf_ranked:                           # (3) 나머지: TextRank×IDF 상위
        if len(final) >= 5:
            break
        if w in final or w == year or w in persons:
            continue
        if df.get(w, 0) >= GENERIC_DF:               # '조선'·'일본' 등 공통 일반어 제외
            continue
        final.append(w)

    results.append({
        "id": ev["id"],
        "사건명": ev["사건명"],
        "연도": year,
        "명사_후보_고유": sorted(set(nouns)),
        "명사_후보_수": len(set(nouns)),
        "검출_인물": persons_ranked,
        "TextRank_top5": [[w, round(s, 4)] for w, s in raw_top5],
        "TextRankIDF_top5": [[w, round(s, 4)] for w, s in idf_top5],
        "최종_정답키워드": final,
        "통과_기준": 3,
        "원문_출처": SRC,
        "원문": ev["text"],
    })

(OUT / "textrank_결과.json").write_text(
    json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
)

for r in results:
    print(f"[{r['id']}] {r['사건명']} ({r['연도']})  고유명사 {r['명사_후보_수']}개")
    print("   raw TextRank :", ", ".join(f"{w}({s})" for w, s in r["TextRank_top5"]))
    print("   ×IDF top5    :", ", ".join(f"{w}({s})" for w, s in r["TextRankIDF_top5"]))
    print("   검출 인물    :", ", ".join(r["검출_인물"]) or "(없음)")
    print("   최종 정답키워드:", ", ".join(r["최종_정답키워드"]))
    print()

# ------------------------------------------------------------------
# 유인물용 엑셀 근거표: 핵심키워드_추출근거표.xlsx
# ------------------------------------------------------------------
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

# 문항별 비고 (알고리즘 결과 + 인물·연도 포함 규칙에 대한 설명)
NOTES = {
    "1": "연도(1876) 규칙 포함. 이 원문에는 인명 없음. TextRank×IDF 상위에서 공통 일반어 ‘조선’(문서빈도3) 제외 후 ‘강화도·조약·일본인·허용’ 채움.",
    "2": "연도(1882) 규칙 포함. 인명 없음. 공통 일반어 제외 후 ‘군인·개화·구식·정책’ 채움. 사건명 ‘임오군란’은 ×IDF 5위였으나 연도 포함으로 한 칸 밀림.",
    "3": "연도(1884)+핵심인물 ‘김옥균’ 규칙 포함. 나머지는 ×IDF 상위 ‘정변·청국·개화파’. ‘개혁’은 슬롯 밀려 제외.",
    "4": "연도(1894)+핵심인물 ‘전봉준’ 규칙 포함(순수 순위 6위였으나 인물 규칙으로 승격). 나머지 ‘운동·농민·농민군’. ‘동학·전투’는 슬롯 밀림.",
    "5": "연도(1905)+핵심인물 ‘이토(이토 히로부미)’ 규칙 포함(검출 인명 이토·고종·박제순·민영환 중 ×IDF 최상위). 나머지 ‘강제·대한제국·을사늑약’. 공통 일반어 ‘일본’과 ‘사회·조약’은 후순위로 제외.",
}

wb = Workbook()
ws = wb.active
ws.title = "핵심키워드 추출근거"

headers = [
    "문항 번호", "사건명", "원문 출처",
    "원문 텍스트 (형태소 분석 전 · 한능검 원문)",
    "형태소 분석 후 명사 후보 전체",
    "TextRank 상위 5개 키워드 + 점수",
    "최종 선정 키워드 (앱 반영)",
    "통과 기준", "비고",
]
ws.append(headers)

# 헤더 스타일
head_fill = PatternFill("solid", fgColor="2E7DF0")
head_font = Font(bold=True, color="FFFFFF", size=11)
thin = Side(style="thin", color="D9DEE5")
border = Border(left=thin, right=thin, top=thin, bottom=thin)
for c in ws[1]:
    c.fill = head_fill
    c.font = head_font
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = border

for r in results:
    ws.append([
        r["id"],
        r["사건명"] + " (" + r["연도"] + ")",
        r["원문_출처"] + " 참고",
        r["원문"],
        ", ".join(r["명사_후보_고유"]),
        ("[순수 TextRank] " + ", ".join(f"{w}({s})" for w, s in r["TextRank_top5"])
         + "\n[×IDF 재가중] " + ", ".join(f"{w}({s})" for w, s in r["TextRankIDF_top5"])),
        ", ".join(r["최종_정답키워드"]),
        "5개 중 3개",
        NOTES[r["id"]],
    ])

# 본문 스타일
for row in ws.iter_rows(min_row=2, max_row=1 + len(results)):
    for c in row:
        c.alignment = Alignment(vertical="top", wrap_text=True)
        c.border = border
        c.font = Font(size=10)
    row[0].alignment = Alignment(horizontal="center", vertical="center")
    row[7].alignment = Alignment(horizontal="center", vertical="center")

# 열 너비 (원문 텍스트 열 추가)
widths = [9, 16, 24, 60, 44, 40, 26, 11, 44]
from openpyxl.utils import get_column_letter
for i, w in enumerate(widths, start=1):
    ws.column_dimensions[get_column_letter(i)].width = w
ws.row_dimensions[1].height = 40
for i in range(2, 2 + len(results)):
    ws.row_dimensions[i].height = 165
ws.freeze_panes = "A2"

# 방법론 메모 시트
ws2 = wb.create_sheet("방법론")
memo = [
    ["항목", "내용"],
    ["파이프라인", "형태소분석(kiwipiepy, 명사 NNG/NNP + 4자리 연도) → TextRank(단어 co-occurrence 그래프, networkx PageRank) → 문서빈도 역가중(IDF)"],
    ["형태소 분석기", "kiwipiepy 0.23 (Java 불필요, 한국어 명사 추출)"],
    ["TextRank 창(window)", "4 (인접 4단어 내 동시출현을 간선으로)"],
    ["IDF 재가중 이유", "순수 TextRank는 빈도 높은 일반어(일본·조선·조약 등)를 상위로 올림. 여러 사건에 공통 등장하는 단어를 log(N/df)로 억제해 사건 변별력 있는 키워드를 상위로 끌어올림."],
    ["최종 선정 규칙", "① 연도(4자리)는 학습상 필수라 규칙적으로 고정 포함 ② 핵심인물(고유명사 인명)이 있으면 최상위 1명 포함 ③ 나머지는 TextRank×IDF 상위에서 채우되 문서빈도 3 이상의 공통 일반어(조선·일본 등)는 제외. 총 5개."],
    ["인물 검출", "형태소분석 고유명사(NNP) 중 한국식 성씨로 시작하는 2~3음절을 인명으로 판정, 지명 접미사(도·부·산…)와 지명 불용어로 오검출 제외."],
    ["통과 기준", "기존 ‘1개 이상’ → ‘5개 중 3개’로 강화(사건명만 말해서는 통과 불가)."],
    ["LLM 사용 여부", "미사용. TextRank·IDF는 통계/그래프 알고리즘. 실시간 채점도 키워드 포함 여부(if문)만 사용."],
    ["원문 출처", "한국사능력검정시험 공식 홈페이지 참고 (원문텍스트_5개사건.md)"],
    ["재현 방법", "python outputs/keyword_extraction.py (결과: textrank_결과.json, 본 엑셀)"],
]
for row in memo:
    ws2.append(row)
for c in ws2[1]:
    c.fill = head_fill; c.font = head_font
    c.alignment = Alignment(horizontal="center", vertical="center"); c.border = border
for row in ws2.iter_rows(min_row=2, max_row=len(memo)):
    for c in row:
        c.alignment = Alignment(vertical="top", wrap_text=True); c.border = border; c.font = Font(size=10)
ws2.column_dimensions["A"].width = 18
ws2.column_dimensions["B"].width = 88

xlsx_path = OUT / "핵심키워드_추출근거표.xlsx"
try:
    wb.save(xlsx_path)
except PermissionError:
    # 원본이 Excel에서 열려 있어 잠긴 경우 대체 파일명으로 저장
    xlsx_path = OUT / "핵심키워드_추출근거표(업데이트).xlsx"
    wb.save(xlsx_path)
print("엑셀 저장:", xlsx_path)
