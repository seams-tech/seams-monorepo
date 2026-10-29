"""Bakery speech texts for the speech-to-text bench.

Spoken text writes numbers as words so that every voice reads them the same
way. The scorer normalizes numbers in the reference and the transcript.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Dictation:
    id: str
    text: str
    key_terms: tuple[str, ...]


@dataclass(frozen=True)
class ApprovalPhrase:
    id: str
    text: str
    near_misses: tuple[tuple[str, str], ...]


DICTATION_EN: tuple[Dictation, ...] = (
    Dictation("en01", "Order twelve kilos of T55 flour from Kanto Mills for Friday.", ("12", "T55", "Kanto Mills")),
    Dictation("en02", "Bake forty croissants and twenty pain au chocolat before seven.", ("40", "croissants", "20", "pain au chocolat")),
    Dictation("en03", "The kouign-amann batch came out too dark, lower the oven to one hundred and eighty degrees.", ("kouign-amann", "180")),
    Dictation("en04", "Move the financier order for Mrs Tanaka to Saturday morning.", ("financier", "Tanaka", "Saturday")),
    Dictation("en05", "We are out of Échiré butter, ask the supplier for the next delivery date.", ("Échiré", "butter")),
    Dictation("en06", "Add six canelés to the gift box for the Shibuya shop.", ("6", "canelés", "Shibuya")),
    Dictation("en07", "How many madeleines did we sell yesterday?", ("madeleines", "yesterday")),
    Dictation("en08", "Mark the mille-feuille as sold out on the online shop.", ("mille-feuille", "sold out")),
    Dictation("en09", "Send the Valrhona invoice to the accountant.", ("Valrhona", "invoice")),
    Dictation("en10", "Refund order four one two, the éclairs arrived damaged.", ("412", "éclairs")),
    Dictation("en11", "Start the brioche dough at five thirty tomorrow.", ("brioche", "5:30")),
    Dictation("en12", "The proofer is at twenty eight degrees and seventy five percent humidity.", ("proofer", "28", "75%")),
    Dictation("en13", "Reorder two cases of matcha powder and one case of yuzu purée.", ("2", "matcha", "1", "yuzu purée")),
    Dictation("en14", "Put the Paris-Brest on the menu board for the weekend.", ("Paris-Brest", "menu board")),
    Dictation("en15", "Check the sablé cookie stock for the Ginza gift shop.", ("sablé", "Ginza")),
    Dictation("en16", "Tell the morning team that the laminator needs cleaning.", ("laminator", "cleaning")),
    Dictation("en17", "Change the price of the strawberry shortcake to six hundred and fifty yen.", ("strawberry shortcake", "650", "yen")),
    Dictation("en18", "The pâte sucrée needs to rest for two hours in the fridge.", ("pâte sucrée", "2 hours")),
    Dictation("en19", "Schedule a delivery of thirty baguettes to Café Lumière at eight.", ("30", "baguettes", "Café Lumière", "8")),
    Dictation("en20", "Log a quality check, the croissant lamination has twenty seven layers.", ("lamination", "27")),
    Dictation("en21", "Record a waste of eleven pain aux raisins from yesterday.", ("11", "pain aux raisins")),
    Dictation("en22", "Ask Satyr to draft a reply to the wedding cake enquiry.", ("Satyr", "wedding cake")),
    Dictation("en23", "Hold the chestnut Mont Blanc order until the cream delivery arrives.", ("chestnut", "Mont Blanc", "cream")),
    Dictation("en24", "What is the margin on the macaron gift box of twelve?", ("macaron", "12")),
    Dictation("en25", "Lower the mixer speed to two for the brioche.", ("mixer", "2", "brioche")),
    Dictation("en26", "The financier batter needs one hundred and twenty grams of brown butter.", ("financier", "120", "brown butter")),
    Dictation("en27", "Print labels for the Christmas stollen with the allergen list.", ("stollen", "allergen")),
    Dictation("en28", "Set the deck oven to two hundred and thirty degrees with steam.", ("deck oven", "230", "steam")),
    Dictation("en29", "Cancel the standing order of sourdough for Hotel Mercer.", ("sourdough", "Hotel Mercer")),
    Dictation("en30", "Approve the purchase order for Isigny cream and Guérande salt.", ("Isigny", "Guérande")),
)

# The shop's menu, suppliers and places. A real shop passes this list to the
# model; it holds more names than any one sentence uses.
VOCABULARY_EN: tuple[str, ...] = (
    "T55", "Kanto Mills", "croissant", "pain au chocolat", "kouign-amann",
    "financier", "Échiré", "canelé", "madeleine", "mille-feuille", "Valrhona",
    "éclair", "brioche", "proofer", "matcha", "yuzu purée", "Paris-Brest",
    "sablé", "Ginza", "Shibuya", "laminator", "shortcake", "pâte sucrée",
    "baguette", "Café Lumière", "pain aux raisins", "Mont Blanc", "macaron",
    "stollen", "deck oven", "sourdough", "Hotel Mercer", "Isigny", "Guérande",
    "Satyr", "Tanaka", "kougelhopf", "pithivier", "galette des rois",
    "tarte tatin", "opéra", "dacquoise", "chouquette", "fougasse", "pain de mie",
    "melon pan", "anpan", "castella", "Hokkaido milk", "Tokachi azuki",
    "Amaou strawberry", "Elle & Vire", "Callebaut", "Daikanyama", "Nishiki",
    "Kagoshima", "praline", "gianduja", "crème pâtissière", "frangipane",
)

APPROVAL_EN: tuple[ApprovalPhrase, ...] = (
    ApprovalPhrase("ap01", "approve the flour order from kanto mills", (
        ("negation", "do not approve the flour order from kanto mills"),
        ("verb", "reject the flour order from kanto mills"),
        ("detail", "approve the butter order from kanto mills"),
        ("missing", "approve the order from kanto mills"),
    )),
    ApprovalPhrase("ap02", "send the croissant order to cafe lumiere", (
        ("negation", "do not send the croissant order to cafe lumiere"),
        ("verb", "cancel the croissant order to cafe lumiere"),
        ("detail", "send the croissant order to hotel mercer"),
        ("missing", "send the order to cafe lumiere"),
    )),
    ApprovalPhrase("ap03", "refund order four one two", (
        ("negation", "do not refund order four one two"),
        ("verb", "cancel order four one two"),
        ("detail", "refund order four one three"),
        ("missing", "refund order four two"),
    )),
    ApprovalPhrase("ap04", "allow the agent to read inventory", (
        ("negation", "do not allow the agent to read inventory"),
        ("verb", "block the agent from reading inventory"),
        ("detail", "allow the agent to change inventory"),
        ("missing", "allow the agent to read"),
    )),
    ApprovalPhrase("ap05", "pay the valrhona invoice", (
        ("negation", "do not pay the valrhona invoice"),
        ("verb", "hold the valrhona invoice"),
        ("detail", "pay the callebaut invoice"),
        ("missing", "pay the invoice"),
    )),
    ApprovalPhrase("ap06", "cancel the sourdough standing order", (
        ("negation", "do not cancel the sourdough standing order"),
        ("verb", "renew the sourdough standing order"),
        ("detail", "cancel the baguette standing order"),
        ("missing", "cancel the standing order"),
    )),
    ApprovalPhrase("ap07", "publish the new menu board", (
        ("negation", "do not publish the new menu board"),
        ("verb", "delete the new menu board"),
        ("detail", "publish the old menu board"),
        ("missing", "publish the menu board"),
    )),
    ApprovalPhrase("ap08", "approve twelve thousand yen for butter", (
        ("negation", "do not approve twelve thousand yen for butter"),
        ("verb", "reject twelve thousand yen for butter"),
        ("detail", "approve twenty thousand yen for butter"),
        ("missing", "approve twelve yen for butter"),
    )),
    ApprovalPhrase("ap09", "give the agent access to gift orders", (
        ("negation", "do not give the agent access to gift orders"),
        ("verb", "remove the agent access to gift orders"),
        ("detail", "give the agent access to all orders"),
        ("missing", "give the agent access to orders"),
    )),
    ApprovalPhrase("ap10", "mark batch seven as passed", (
        ("negation", "do not mark batch seven as passed"),
        ("verb", "mark batch seven as failed"),
        ("detail", "mark batch eleven as passed"),
        ("missing", "mark batch as passed"),
    )),
    ApprovalPhrase("ap11", "send the wedding cake reply", (
        ("negation", "do not send the wedding cake reply"),
        ("verb", "discard the wedding cake reply"),
        ("detail", "send the birthday cake reply"),
        ("missing", "send the reply"),
    )),
    ApprovalPhrase("ap12", "approve the refund of six hundred yen", (
        ("negation", "do not approve the refund of six hundred yen"),
        ("verb", "decline the refund of six hundred yen"),
        ("detail", "approve the refund of six thousand yen"),
        ("missing", "approve the refund of six yen"),
    )),
)

# Second bank, written after the 2026-10-29 run. Each phrase names one action
# with common words and numbers only. It avoids names, foreign words and words
# that sound like another word (flour, for, to, two, eight, one, new, sell,
# sales, cash, add, by, buy, read, see, rights, weekly, access). The near
# misses keep the same four kinds of change.
APPROVAL_EN_V2: tuple[ApprovalPhrase, ...] = (
    ApprovalPhrase("bp01", "pay invoice three five nine", (
        ("negation", "do not pay invoice three five nine"),
        ("verb", "hold invoice three five nine"),
        ("detail", "pay invoice three five six"),
        ("missing", "pay invoice three nine"),
    )),
    ApprovalPhrase("bp02", "send order seven three six", (
        ("negation", "do not send order seven three six"),
        ("verb", "hold order seven three six"),
        ("detail", "send order seven three nine"),
        ("missing", "send order seven six"),
    )),
    ApprovalPhrase("bp03", "refund six hundred yen", (
        ("negation", "do not refund six hundred yen"),
        ("verb", "charge six hundred yen"),
        ("detail", "refund six thousand yen"),
        ("missing", "refund six yen"),
    )),
    ApprovalPhrase("bp04", "give the agent stock control", (
        ("negation", "do not give the agent stock control"),
        ("verb", "deny the agent stock control"),
        ("detail", "give the agent bank control"),
        ("missing", "give the agent control"),
    )),
    ApprovalPhrase("bp05", "ship batch five today", (
        ("negation", "do not ship batch five today"),
        ("verb", "hold batch five today"),
        ("detail", "ship batch nine today"),
        ("missing", "ship batch today"),
    )),
    ApprovalPhrase("bp06", "cancel the monthly cake order", (
        ("negation", "do not cancel the monthly cake order"),
        ("verb", "renew the monthly cake order"),
        ("detail", "cancel the yearly cake order"),
        ("missing", "cancel the cake order"),
    )),
    ApprovalPhrase("bp07", "publish the spring price list", (
        ("negation", "do not publish the spring price list"),
        ("verb", "delete the spring price list"),
        ("detail", "publish the winter price list"),
        ("missing", "publish the price list"),
    )),
    ApprovalPhrase("bp08", "pay three thousand yen deposit", (
        ("negation", "do not pay three thousand yen deposit"),
        ("verb", "refund three thousand yen deposit"),
        ("detail", "pay five thousand yen deposit"),
        ("missing", "pay three yen deposit"),
    )),
    ApprovalPhrase("bp09", "send the reply about the cake", (
        ("negation", "do not send the reply about the cake"),
        ("verb", "delete the reply about the cake"),
        ("detail", "send the reply about the box"),
        ("missing", "send the reply"),
    )),
    ApprovalPhrase("bp10", "open the shop at nine", (
        ("negation", "do not open the shop at nine"),
        ("verb", "close the shop at nine"),
        ("detail", "open the shop at seven"),
        ("missing", "open the shop"),
    )),
    ApprovalPhrase("bp11", "share the stock report", (
        ("negation", "do not share the stock report"),
        ("verb", "delete the stock report"),
        ("detail", "share the staff report"),
        ("missing", "share the report"),
    )),
    ApprovalPhrase("bp12", "order six boxes of cream", (
        ("negation", "do not order six boxes of cream"),
        ("verb", "return six boxes of cream"),
        ("detail", "order nine boxes of cream"),
        ("missing", "order boxes of cream"),
    )),
)

APPROVAL_BANKS: dict[str, tuple[ApprovalPhrase, ...]] = {
    "approval_en": APPROVAL_EN,
    "approval_en_v2": APPROVAL_EN_V2,
}

# Banks that the scorer knows, including phrases recorded at the bench by `record.py`.
SCORED_BANKS: dict[str, tuple[ApprovalPhrase, ...]] = {
    **APPROVAL_BANKS,
    "human_approval_en_v2": APPROVAL_EN_V2,
}

# Talk at the bench that is not addressed to the laptop.
UNRELATED_EN: tuple[tuple[str, str], ...] = (
    ("un01", "can you pass me the piping bag"),
    ("un02", "the oven timer just went off"),
    ("un03", "where did you put the bench scraper"),
    ("un04", "good morning, the usual please"),
    ("un05", "the delivery van is outside"),
    ("un06", "we need more boxes for the gift sets"),
)

DICTATION_JA: tuple[Dictation, ...] = (
    Dictation("ja01", "明日の朝七時までにクロワッサンを四十個焼いてください。", ("7", "クロワッサン", "40")),
    Dictation("ja02", "関東製粉に小麦粉を十二キロ注文して。", ("関東製粉", "小麦粉", "12")),
    Dictation("ja03", "エシレバターの在庫がありません。次の納品日を確認してください。", ("エシレ", "バター", "納品日")),
    Dictation("ja04", "フィナンシェの注文を土曜日の午前に移動して。", ("フィナンシェ", "土曜日")),
    Dictation("ja05", "昨日のマドレーヌの売上はいくつですか。", ("マドレーヌ", "売上")),
    Dictation("ja06", "ミルフィーユをオンラインショップで売り切れにして。", ("ミルフィーユ", "売り切れ")),
    Dictation("ja07", "注文番号四一二を返金してください。エクレアが破損していました。", ("412", "返金", "エクレア")),
    Dictation("ja08", "発酵機の温度は二十八度、湿度は七十五パーセントです。", ("発酵機", "28", "75")),
    Dictation("ja09", "抹茶パウダーを二ケース、柚子ピューレを一ケース追加で注文して。", ("抹茶", "2", "柚子", "1")),
    Dictation("ja10", "いちごのショートケーキの価格を六百五十円に変更して。", ("ショートケーキ", "650")),
    Dictation("ja11", "銀座店のサブレの在庫を確認して。", ("銀座", "サブレ")),
    Dictation("ja12", "デッキオーブンを二百三十度、スチームありに設定して。", ("デッキオーブン", "230", "スチーム")),
    Dictation("ja13", "ホテルメルサーへのカンパーニュの定期注文をキャンセルして。", ("メルサー", "カンパーニュ", "キャンセル")),
    Dictation("ja14", "クリスマスのシュトーレン用にアレルゲン表示ラベルを印刷して。", ("シュトーレン", "アレルゲン")),
    Dictation("ja15", "モンブランの注文は生クリームが届くまで保留にして。", ("モンブラン", "生クリーム", "保留")),
)

VOCABULARY_JA: tuple[str, ...] = (
    "関東製粉", "クロワッサン", "エシレ", "フィナンシェ", "マドレーヌ",
    "ミルフィーユ", "エクレア", "発酵機", "抹茶", "柚子ピューレ",
    "ショートケーキ", "サブレ", "銀座店", "デッキオーブン", "ホテルメルサー",
    "カンパーニュ", "シュトーレン", "アレルゲン", "モンブラン", "生クリーム",
    "カヌレ", "ブリオッシュ", "クイニーアマン", "パリブレスト", "メロンパン",
    "あんぱん", "カステラ", "マカロン", "ガレット・デ・ロワ", "タルトタタン",
)

VOICES_DICTATION_EN = ("Samantha", "Daniel", "Karen", "Moira", "Rishi", "Tessa")
VOICES_APPROVAL_EN = ("Samantha", "Daniel", "Karen", "Rishi")
VOICES_JA = ("Kyoko",)
