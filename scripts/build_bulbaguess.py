#!/usr/bin/env python3
"""Собрать данные Bulba Guess.

Словарь — существительные единственного числа, именительный падеж.
Соседи считаются только внутри этого словаря по векторам navec (художественная литература).
Подсказки — два частых понятных слова далеко от загадки, около счетов 50 и 70.
Показывается их настоящий счёт, а не ближайший синоним.

Запуск (из корня клиента, в venv с pymorphy3, navec, numpy):
  python3 scripts/build_bulbaguess.py
Модель navec лежит в scripts/.cache/bulbaguess/ (в git не входит).
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
from pathlib import Path

import numpy as np
from navec import Navec
from pymorphy3 import MorphAnalyzer
from wordfreq import zipf_frequency

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets" / "bulbaguess"
CACHE = ROOT / "scripts" / ".cache" / "bulbaguess"
NAVEC_PATH = CACHE / "navec_hudlit.tar"

# Сколько самых частых токенов корпуса разбираем, чтобы сложить частоту лемм.
TOKEN_SCAN = 180_000
# Словарь, который можно ввести. Режем по живой частотности (zipf), а не по
# частоте в художественном корпусе: иначе в соседи лезут имена персонажей.
SCORABLE_N = 10_000
ZIPF_SCORABLE = 2.45
ZIPF_SECRET = 4.20
ZIPF_HINT = 3.30
ZIPF_HINT_RELAXED = 3.00
# Сколько соседей хранить. Хватает, чтобы шкала дошла примерно до 74,
# и подсказка «70» ещё попадает в список.
NEIGHBORS = 340
SIM_K = 120
# Две подсказки: не синонимы, а слова с этими счетами. Редкое слово на самой
# отметке пропускаем и берём ближайшее понятное рядом.
HINT_SCORES = (70, 50)
# Сколько загадок оставить: частые и при этом предметные существительные.
SECRET_TARGET = 800

# Слово одновременно имя и обычное существительное — оставляем обычный смысл.
AMBIGUOUS_OK = {"лев", "роза", "лилия", "ирис", "мак", "пол", "кит", "блин", "жук"}
# Несклоняемые, которые правда являются словами, а не именами.
FIXD_OK = {
    "кофе", "какао", "метро", "такси", "кино", "радио", "пальто", "кафе", "шоссе",
    "меню", "интервью", "пианино", "кенгуру", "пони", "алиби", "жюри", "фото",
    "бюро", "депо", "евро", "шоу", "пюре", "филе", "желе", "рагу", "бра", "хобби",
    "резюме", "пенсне", "шимпанзе", "колибри", "киви", "какаду", "конферансье",
}
# pymorphy считает это существительным, но в речи это не слово-загадка.
NOT_A_NOUN = {
    "напрокат", "спасибо", "привет", "ага", "пока", "алло", "ура", "бис", "браво",
    "сити", "ниссан", "тойота", "шевроле", "фольксваген", "вольво", "кадиллак",
    "мерседес", "бмв", "ауди", "форд", "опель", "лексус", "хонда", "мазда",
    "рада", "динамо", "педофил", "стояк", "полжизни", "свами", "говнюк",
    "глория", "стелла", "мелисса", "марго", "морин", "клер", "камерон", "харт",
    "спенсер", "росс", "нейл", "грант", "прайс", "изабелла", "амелия", "донна",
    "вивьен", "эбби", "мередит", "вика", "девон", "попович",
}

CYR = re.compile(r"^[а-яё]{2,18}$")
VOWELS = set("аеёиоуыэюя")
PROPER = ("Name", "Surn", "Patr", "Geox", "Orgn", "Trad")
BAD_GRAM = ("Abbr", "Arch", "Dist", "Erro", "Init", "Slng")

# Не загадываем и не кладём в соседи: иначе подсказкой или ответом станет обсценное слово.
OBSCENE_PREFIXES = (
    "хуй", "пизд", "ебл", "ебан", "ебат", "заеб", "уеб", "наеб", "поеб",
    "проеб", "долбое", "пидор", "пидар", "бляд", "муда", "шлюх", "гандон", "гондон",
    "говн", "засра",
)
OBSCENE_EXACT = {
    "хер", "манда", "сука", "говно", "срака", "жопа", "задница", "херня",
    "мудила", "залупа", "ебло", "пиздюк", "хуесос", "дерьмо", "сволочь",
    "стерва", "придурок", "дура",
}

# Слишком общие существительные: их можно ввести, но подсказкой они бесполезны,
# и загадывать их не стоит — рядом с ними оказывается полсловаря.
VAGUE = {
    "время", "жизнь", "мысль", "идея", "причина", "цель", "способ", "система",
    "процесс", "условие", "отношение", "качество", "количество", "смысл", "право",
    "закон", "власть", "сила", "возможность", "проблема", "вопрос", "случай",
    "момент", "период", "уровень", "вид", "форма", "часть", "группа", "ряд",
    "число", "результат", "действие", "состояние", "чувство", "мнение", "знание",
    "опыт", "интерес", "путь", "образ", "факт", "пример", "вариант", "функция",
    "элемент", "ситуация", "область", "тип", "конец", "начало", "слово", "дело",
    "место", "раз", "человек", "вещь", "штука", "предмет", "сторона", "порядок",
    "значение", "основа", "средство", "условие", "данные", "информация", "объект",
    "фактор", "характер", "степень", "мера", "род", "счет", "счёт", "лицо",
    "случай", "повод", "цель", "задача", "работа", "труд", "деятельность",
    "любовь", "надежда", "вера", "душа", "судьба", "смерть", "страх", "радость",
    "боль", "счастье", "правда", "ложь", "красота", "свобода", "память", "мечта",
    "тайна", "честь", "слава", "ненависть", "злость", "грусть", "горе", "беда",
    "название", "сан", "пора", "главное",
}

# Существительное в обычной речи, хотя первый разбор pymorphy — другая часть речи.
CLEAR_NOUN_OK = {"марш"}
# Существительные, которые не хочется загадывать.
NOT_SECRET = {"проститутка", "девка", "гадость", "дрянь", "кокс", "фига", "сьерра", "мадонна"}
# Частые слова, которые центроид конкретности занижает, но их легко загадать.
EVERYDAY = {
    "день", "час", "книга", "школа", "врач", "учитель", "доктор", "семья",
    "ребенок", "письмо", "газета", "песня", "праздник", "футбол", "церковь",
    "король", "музыка",
}

CONCRETE_SEEDS = [
    "стол", "собака", "яблоко", "дом", "река", "рука", "хлеб", "машина", "дерево",
    "книга", "молоко", "окно", "рыба", "цветок", "город", "лес", "кошка", "вода",
    "стул", "шапка", "ложка", "гора", "птица", "трава", "камень", "платье", "яйцо",
    "врач", "школа", "поезд", "море", "солнце", "гитара", "тарелка", "ягода",
]
ABSTRACT_SEEDS = [
    "время", "жизнь", "мысль", "идея", "причина", "цель", "способ", "система",
    "процесс", "условие", "отношение", "качество", "количество", "смысл", "право",
    "закон", "власть", "сила", "возможность", "проблема", "вопрос", "случай",
    "момент", "период", "уровень", "вид", "форма", "часть", "группа", "ряд",
    "число", "результат", "действие", "состояние", "чувство", "мнение", "знание",
    "опыт", "интерес", "путь", "образ", "факт", "пример", "вариант", "элемент",
    "ситуация", "область", "тип", "конец", "начало",
]


def norm(word: str) -> str:
    return word.replace("ё", "е").replace("Ё", "Е").lower()


def js_round(value: float) -> int:
    """Math.round для положительных чисел: половина вверх, не банковское округление."""
    return int(math.floor(value + 0.5))


def pos_to_score(pos: int) -> int:
    if pos == 0:
        return 1
    return min(100, 1 + js_round((99 * pos) / (pos + SIM_K)))


def obscene(word: str) -> bool:
    if word in OBSCENE_EXACT or word in {norm(w) for w in OBSCENE_EXACT}:
        return True
    return word.startswith(OBSCENE_PREFIXES)


def has_vowel(word: str) -> bool:
    return any(ch in VOWELS for ch in word)


def is_bad_tag(tag: str) -> bool:
    return any(g in tag for g in PROPER) or any(g in tag for g in BAD_GRAM) or "Pltm" in tag


def common_noun_parses(parses):
    found = []
    for parse in parses:
        tag = str(parse.tag)
        if "NOUN" not in tag or is_bad_tag(tag):
            continue
        found.append(parse)
    return found


def lemma_of_token(morph: MorphAnalyzer, token: str) -> str | None:
    parses = morph.parse(token)
    if not parses:
        return None
    common = common_noun_parses(parses)
    if not common:
        return None
    common_score = sum(parse.score for parse in common)
    best = parses[0]
    if "NOUN" not in str(best.tag) and common_score < 0.3:
        return None
    parse = max(common, key=lambda item: item.score)
    lemma = norm(parse.normal_form)
    if not CYR.match(lemma) or not has_vowel(lemma) or obscene(lemma):
        return None
    return lemma


def lemma_is_nominative(morph: MorphAnalyzer, lemma: str) -> bool:
    """Лемма сама является существительным ед. ч. им. п.

    У «глаз» и «метро» именительный делит вероятность с другими падежами той же
    формы, поэтому порог низкий: от мусора защищает частотность и словарь pymorphy.
    Междометия («спасибо») и глаголы отсекаются, даже если у них есть слабый
    разбор существительным. «Пожарный» остаётся: существительное там почти равно
    прилагательному.
    """
    parses = morph.parse(lemma)
    if not parses:
        return False
    if lemma in AMBIGUOUS_OK:
        return True
    best_tag = str(parses[0].tag)
    nomn = 0.0
    for parse in common_noun_parses(parses):
        if norm(parse.normal_form) != lemma:
            continue
        tag = str(parse.tag)
        if "sing" not in tag or "nomn" not in tag or "Infr" in tag:
            continue
        nomn += parse.score
    if nomn < 0.03:
        return False
    if "NOUN" in best_tag and not is_bad_tag(best_tag):
        return nomn >= 0.03
    if lemma in AMBIGUOUS_OK and nomn >= 0.02:
        return True
    # «пожарный», «блин»: существительное не первый разбор, но оно настоящее.
    return nomn >= 0.15


def clear_noun(morph: MorphAnalyzer, lemma: str) -> bool:
    """Загадка и подсказка: это существительное, а не прилагательное с запасным разбором.

    «Конный» pymorphy считает прилагательным и существительным поровну — такое
    слово не загадываем. «Хлеб» остаётся: первый разбор винительный, но это
    всё равно существительное. «Пьяный» отсекается, потому что прилагательное
    не слабее существительного.
    """
    if lemma in AMBIGUOUS_OK or lemma in CLEAR_NOUN_OK:
        return lemma_is_nominative(morph, lemma)
    if not lemma_is_nominative(morph, lemma):
        return False
    parses = morph.parse(lemma)
    if not parses:
        return False
    best = parses[0]
    best_tag = str(best.tag)
    if norm(best.normal_form) != lemma or "NOUN" not in best_tag or is_bad_tag(best_tag):
        return False
    noun = 0.0
    adjective = 0.0
    for parse in parses:
        tag = str(parse.tag)
        same = norm(parse.normal_form) == lemma
        if same and "NOUN" in tag and "sing" in tag and "nomn" in tag and not is_bad_tag(tag):
            noun = max(noun, parse.score)
        # «старое»: прилагательное приводится к «старый», но это разбор той же формы.
        if any(mark in tag for mark in ("ADJF", "ADJS", "PRTF", "PRTS")):
            adjective = max(adjective, parse.score)
    return noun > adjective


def mainly_fixd(morph: MorphAnalyzer, lemma: str) -> bool:
    """Несклоняемое слово. Имена вроде «марго» так устроены, «метро» — нет, оно в списке."""
    if lemma in FIXD_OK:
        return False
    for parse in morph.parse(lemma):
        if norm(parse.normal_form) != lemma:
            continue
        tag = str(parse.tag)
        if "NOUN" in tag and "sing" in tag and "nomn" in tag:
            return "Fixd" in tag
    return False


def known_lemma(morph: MorphAnalyzer, lemma: str) -> bool:
    if morph.word_is_known(lemma):
        return True
    for parse in morph.parse(lemma):
        yo = parse.normal_form
        if norm(yo) == lemma and morph.word_is_known(yo):
            return True
    return False


def zipf_of(morph: MorphAnalyzer, lemma: str) -> float:
    scores = [zipf_frequency(lemma, "ru")]
    for parse in morph.parse(lemma):
        if norm(parse.normal_form) == lemma:
            scores.append(zipf_frequency(parse.normal_form, "ru"))
    return max(scores)


def name_blocked(morph: MorphAnalyzer, lemma: str, zipf: float) -> bool:
    """Имя или фамилия сильнее обычного существительного.

    Сравниваем лучший разбор, а не сумму: у «жука» фамильные падежи по отдельности
    слабые, но в сумме перевешивают насекомое.
    """
    if lemma in AMBIGUOUS_OK:
        return False
    best_name = 0.0
    best_common = 0.0
    for parse in morph.parse(lemma):
        tag = str(parse.tag)
        if any(gram in tag for gram in ("Name", "Surn", "Patr")):
            best_name = max(best_name, parse.score)
        elif "NOUN" in tag and not is_bad_tag(tag):
            best_common = max(best_common, parse.score)
    if best_name < 0.35 or best_name <= best_common:
        return False
    return not (best_common >= 0.15 and zipf >= 4.0)


def too_similar(a: str, b: str) -> bool:
    if a == b:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) >= 4 and short in long_:
        return True
    # «лук»/«лука», «ком»/«комок» — та же основа с коротким хвостом.
    if len(short) >= 3 and long_.startswith(short) and len(long_) - len(short) <= 2:
        return True
    shared = 0
    for ca, cb in zip(a, b):
        if ca != cb:
            break
        shared += 1
    if shared >= 5:
        return True
    return shared >= 4 and abs(len(a) - len(b)) <= 2


def vector_key(morph: MorphAnalyzer, vocab, lemma: str) -> str | None:
    if lemma in vocab:
        return lemma
    for parse in morph.parse(lemma):
        yo = parse.normal_form
        if norm(yo) == lemma and yo in vocab:
            return yo
    return None


def first_hint(
    words: list[str],
    neigh: list[int],
    secret: str,
    min_score: int,
    max_score: int | None,
    banned: set[str],
    hint_ok: list[bool],
) -> tuple[int, int, str] | None:
    """Ближайшее понятное слово в диапазоне счёта. Список соседей уже по убыванию близости."""
    for pos in range(1, len(neigh)):
        score = pos_to_score(pos)
        if score < min_score:
            continue
        if max_score is not None and score > max_score:
            break
        idx = neigh[pos]
        if not hint_ok[idx]:
            continue
        word = words[idx]
        if word in banned or too_similar(word, secret):
            continue
        return pos, score, word
    return None


def hint_at(
    words: list[str],
    neigh: list[int],
    secret: str,
    target: int,
    banned: set[str],
    hint_ok: list[bool],
) -> tuple[int, int, str] | None:
    """Понятное слово со счётом около target. Сначала не ближе цели, потом чуть ближе."""
    found = first_hint(words, neigh, secret, target, target + 4, banned, hint_ok)
    if found:
        return found
    return first_hint(words, neigh, secret, max(2, target - 6), target + 10, banned, hint_ok)


def build_forms(morph: MorphAnalyzer, words: list[str], aliases: dict[str, set[str]]) -> dict[str, str]:
    """Форма → лемма. Сами леммы в карту не кладём: они и так есть в словаре."""
    known = set(words)
    candidates: dict[str, set[str]] = {}
    for lemma in words:
        parse = None
        for item in morph.parse(lemma):
            tag = str(item.tag)
            if norm(item.normal_form) != lemma:
                continue
            if "NOUN" in tag and "sing" in tag and "nomn" in tag and not is_bad_tag(tag):
                parse = item
                break
        if parse is None:
            continue
        for form in parse.lexeme:
            if "NOUN" not in str(form.tag):
                continue
            surface = norm(form.word)
            if not surface or surface == lemma or surface in known or not CYR.match(surface):
                continue
            candidates.setdefault(surface, set()).add(lemma)
    for surface, lemmas in aliases.items():
        if surface in known or not CYR.match(surface):
            continue
        for lemma in lemmas:
            if lemma in known:
                candidates.setdefault(surface, set()).add(lemma)

    forms: dict[str, str] = {}
    for surface, lemmas in candidates.items():
        noun_lemmas = [lemma for lemma in lemmas if lemma in known]
        if not noun_lemmas:
            continue
        best = morph.parse(surface)[0]
        best_lemma = norm(best.normal_form) if "NOUN" in str(best.tag) else None
        if best_lemma in noun_lemmas and best.score >= 0.25:
            forms[surface] = best_lemma
        elif len(noun_lemmas) == 1:
            # «ежи» словарь первым делом считает именем, но это форма «ежа».
            forms[surface] = noun_lemmas[0]
    return forms


def unit_centroid(navec: Navec, seeds: list[str]) -> np.ndarray:
    vectors = []
    for seed in seeds:
        key = seed if seed in navec else None
        if key is None:
            continue
        vector = np.asarray(navec[key], dtype=np.float32)
        length = np.linalg.norm(vector)
        if length:
            vectors.append(vector / length)
    if len(vectors) < 8:
        raise SystemExit("не хватило опорных слов")
    center = np.mean(vectors, axis=0)
    return center / np.linalg.norm(center)


def concreteness(vecs: np.ndarray, words: list[str]) -> np.ndarray:
    index = {word: i for i, word in enumerate(words)}

    def centroid(seeds: list[str]) -> np.ndarray | None:
        ids = [index[norm(seed)] for seed in seeds if norm(seed) in index]
        if len(ids) < 8:
            return None
        center = vecs[ids].mean(axis=0)
        n = np.linalg.norm(center)
        if n == 0:
            return None
        return center / n

    concrete = centroid(CONCRETE_SEEDS)
    abstract = centroid(ABSTRACT_SEEDS)
    if concrete is None or abstract is None:
        raise SystemExit("не хватило опорных слов для конкретности")
    return vecs @ concrete - vecs @ abstract


def load_old_targets() -> list[str]:
    path = CACHE / "original-targets.txt"
    if path.exists():
        return [line for line in path.read_text(encoding="utf-8").splitlines() if line]
    return []


def main() -> None:
    if not NAVEC_PATH.exists():
        raise SystemExit(f"нет модели {NAVEC_PATH}")
    started = time.time()
    print("гружу словарь и векторы...", flush=True)
    morph = MorphAnalyzer()
    navec = Navec.load(str(NAVEC_PATH))
    vocab = navec.vocab

    print(f"разбираю {TOKEN_SCAN} частых токенов...", flush=True)
    freq: dict[str, int] = {}
    aliases: dict[str, set[str]] = {}
    for token in vocab.top(TOKEN_SCAN):
        if not CYR.match(token) or not has_vowel(token):
            continue
        lemma = lemma_of_token(morph, token)
        if lemma is None or lemma in NOT_A_NOUN or obscene(lemma):
            continue
        freq[lemma] = freq.get(lemma, 0) + int(vocab.count(token))
        if token != lemma:
            aliases.setdefault(token, set()).add(lemma)

    ranked = sorted(freq.items(), key=lambda item: (-item[1], item[0]))
    print(f"лемм с частотой: {len(ranked)}", flush=True)

    words: list[str] = []
    keys: list[str] = []
    zipfs: list[float] = []
    for lemma, _count in ranked:
        if not known_lemma(morph, lemma) or not lemma_is_nominative(morph, lemma):
            continue
        zipf = zipf_of(morph, lemma)
        if zipf < ZIPF_SCORABLE or name_blocked(morph, lemma, zipf):
            continue
        key = vector_key(morph, vocab, lemma)
        if key is None:
            continue
        words.append(lemma)
        keys.append(key)
        zipfs.append(zipf)

    if len(words) < 3000:
        raise SystemExit(f"слишком мало существительных: {len(words)}")
    # Оставляем самые знакомые, если кандидатов больше окна.
    if len(words) > SCORABLE_N:
        order = sorted(range(len(words)), key=lambda i: (-zipfs[i], words[i]))[:SCORABLE_N]
        words = [words[i] for i in order]
        keys = [keys[i] for i in order]
        zipfs = [zipfs[i] for i in order]
    print(f"словарь до чистки имён: {len(words)}, редкое — «{words[-1]}» zipf {zipfs[-1]:.2f}", flush=True)

    print("векторы, конкретность, имена...", flush=True)
    raw = np.vstack([np.asarray(navec[key], dtype=np.float32) for key in keys])
    lengths = np.linalg.norm(raw, axis=1, keepdims=True)
    lengths[lengths == 0] = 1
    vecs = raw / lengths
    concrete = concreteness(vecs, words)
    vague = {norm(word) for word in VAGUE}
    print(f"словарь: {len(words)}, самое редкое — «{min(zip(zipfs, words))[1]}»", flush=True)

    # Загадки — простые существительные. Либо очень частое бытовое слово,
    # либо чуть реже, но явно предметное (животное, еда, вещь).
    candidates = []
    for index, word in enumerate(words):
        if word in vague or word in NOT_SECRET or len(word) < 3:
            continue
        if mainly_fixd(morph, word) or not clear_noun(morph, word):
            continue
        frequent = zipfs[index] >= 4.5 and word in EVERYDAY
        physical = zipfs[index] >= 3.5 and concrete[index] >= 0.08
        if not (frequent or physical):
            continue
        candidates.append(index)
    candidates.sort(key=lambda index: (-zipfs[index], words[index]))
    print(f"кандидатов в загадки: {len(candidates)}", flush=True)

    def hint_allowed(index: int, min_zipf: float) -> bool:
        word = words[index]
        if zipfs[index] < min_zipf or word in vague:
            return False
        if len(word) <= 3 and zipfs[index] < 4.2:
            return False
        return not mainly_fixd(morph, word) and clear_noun(morph, word)

    hint_strict = [hint_allowed(index, ZIPF_HINT) for index in range(len(words))]
    hint_relaxed = [hint_allowed(index, ZIPF_HINT_RELAXED) for index in range(len(words))]

    print("соседи кандидатов...", flush=True)
    neighbor_of: dict[int, list[int]] = {}
    cosine_of: dict[int, np.ndarray] = {}
    batch = 800
    for start in range(0, len(candidates), batch):
        chunk = candidates[start:start + batch]
        sims = vecs[chunk] @ vecs.T
        for row, idx in enumerate(chunk):
            sims[row, idx] = -2
            top = np.argpartition(-sims[row], NEIGHBORS)[:NEIGHBORS]
            top = top[np.argsort(-sims[row, top])]
            neighbor_of[idx] = [idx] + top.tolist()
            cosine_of[idx] = sims[row]

    print("отбираю загадки и подсказки...", flush=True)
    secrets: list[dict] = []
    dropped = {"diminutive": 0, "isolated": 0, "no_hint": 0, "weak_hint": 0}

    for idx in candidates:
        if len(secrets) >= SECRET_TARGET:
            break
        word = words[idx]
        neigh = neighbor_of[idx]
        cos = cosine_of[idx]
        if len(word) <= 3 and zipfs[idx] < 4.2 and len(words[neigh[1]]) <= 3:
            dropped["isolated"] += 1
            continue
        if float(cos[neigh[1]]) < 0.38:
            dropped["isolated"] += 1
            continue
        if any(
            too_similar(word, words[neigh[pos]]) and len(word) > len(words[neigh[pos]]) and float(cos[neigh[pos]]) >= 0.62
            for pos in range(1, 8)
        ):
            dropped["diminutive"] += 1
            continue

        # Загадка без близкого частого соседа непонятна, даже если подсказки
        # потом берутся далеко. Этот фильтр не выбирает слова, которые видит игрок.
        anchor = first_hint(words, neigh, word, 2, 16, set(), hint_strict)
        if anchor is None:
            anchor = first_hint(words, neigh, word, 2, 22, set(), hint_relaxed)
        if anchor is None or float(cos[neigh[anchor[0]]]) < 0.34:
            dropped["weak_hint"] += 1
            continue
        bridge = first_hint(words, neigh, word, anchor[1] + 6, 42, {anchor[2]}, hint_strict)
        if bridge is None:
            bridge = first_hint(words, neigh, word, anchor[1] + 6, 55, {anchor[2]}, hint_relaxed)
        if bridge is None or float(cos[neigh[bridge[0]]]) < 0.22:
            dropped["weak_hint"] += 1
            continue

        # Дальняя подсказка (~70) ищется первой: у края списка понятных слов меньше.
        far_target, near_target = HINT_SCORES
        far = hint_at(words, neigh, word, far_target, set(), hint_strict)
        if far is None:
            far = hint_at(words, neigh, word, far_target, set(), hint_relaxed)
        if far is None:
            dropped["no_hint"] += 1
            continue
        far_pos, far_score, far_word = far

        near = hint_at(words, neigh, word, near_target, {far_word}, hint_strict)
        if near is None:
            near = hint_at(words, neigh, word, near_target, {far_word}, hint_relaxed)
        if near is None:
            dropped["no_hint"] += 1
            continue
        near_pos, near_score, _near_word = near
        if far_score - near_score < 12:
            dropped["weak_hint"] += 1
            continue

        secrets.append({"t": word, "n": neigh, "h": [far_pos, near_pos]})

    if len(secrets) < 200:
        raise SystemExit(f"после фильтров осталось мало загадок: {len(secrets)} {dropped}")

    print("формы слов...", flush=True)
    forms = build_forms(morph, words, aliases)

    old = load_old_targets()
    print("записываю файлы...", flush=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    words_path = ASSETS / "words.txt"
    forms_path = ASSETS / "forms.txt"
    rounds_path = ASSETS / "rounds.json"
    words_path.write_text("\n".join(words) + "\n", encoding="utf-8")
    form_lines = [f"{surface} {lemma}" for surface, lemma in sorted(forms.items())]
    forms_path.write_text("\n".join(form_lines) + "\n", encoding="utf-8")
    rounds_path.write_text(json.dumps(secrets, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    secret_set = {item["t"] for item in secrets}
    word_set = set(words)
    covered = [w for w in old if norm(w) in secret_set]
    known_not_secret = [w for w in old if norm(w) in word_set and norm(w) not in secret_set]
    missing = [w for w in old if norm(w) not in word_set]

    def show(title: str, indexes: list[int]) -> list[str]:
        lines = [title]
        for idx in indexes:
            item = secrets[idx]
            neigh = item["n"]
            top = ", ".join(words[j] for j in neigh[1:9])
            hints = []
            for pos in item["h"]:
                hints.append(f"{words[neigh[pos]]} ({pos_to_score(pos)})")
            lines.append(f"  {item['t']}: {top}")
            lines.append(f"    подсказки: {', '.join(hints)}")
        return lines

    # Равномерная выборка по частотности, плюс знакомые слова, если они остались загадками.
    pick_idx = list(range(0, len(secrets), max(1, len(secrets) // 24)))[:24]
    for familiar in ("корова", "стол", "солнце", "книга", "школа", "яблоко", "муха", "медведь", "врач", "море", "глаз", "метро", "кенгуру", "еж", "пожар"):
        for i, item in enumerate(secrets):
            if item["t"] == familiar and i not in pick_idx:
                pick_idx.append(i)
                break

    hint_counts: dict[str, int] = {}
    warm_scores = []
    cold_scores = []
    for item in secrets:
        cold_pos, warm_pos = item["h"]
        cold_scores.append(pos_to_score(cold_pos))
        warm_scores.append(pos_to_score(warm_pos))
        for pos in item["h"]:
            hint = words[item["n"][pos]]
            hint_counts[hint] = hint_counts.get(hint, 0) + 1
    popular_hints = sorted(hint_counts.items(), key=lambda kv: -kv[1])[:25]

    checks = {
        "корову": "корова",
        "яблоки": "яблоко",
        "столы": "стол",
        "солнцу": "солнце",
        "ежи": "еж",
        "пожарного": "пожарный",
        "кошке": "кошка",
    }
    form_report = []
    for surface, expected in checks.items():
        got = forms.get(norm(surface))
        if got is None and norm(surface) in word_set:
            got = norm(surface)
        mark = "ok" if got == expected else "НЕ СОВПАЛО"
        form_report.append(f"  {surface} → {got} ({mark}, ждали {expected})")

    lines = [
        f"словарь: {len(words)}",
        f"загадки: {len(secrets)}",
        f"формы: {len(forms)}",
        f"отброшено: {dropped}",
        f"подсказка около 50: min {min(warm_scores)} med {sorted(warm_scores)[len(warm_scores)//2]} max {max(warm_scores)}",
        f"подсказка около 70: min {min(cold_scores)} med {sorted(cold_scores)[len(cold_scores)//2]} max {max(cold_scores)}",
        f"старые загадки снова в пуле: {len(covered)}/{len(old)}",
        f"старые есть в словаре, но не загадываются: {', '.join(known_not_secret[:40])}",
        f"старых нет в словаре: {', '.join(missing)}",
        "",
        "частые подсказки:",
        "  " + ", ".join(f"{w}×{n}" for w, n in popular_hints),
        "",
        "самые частые загадки:",
        "  " + ", ".join(item["t"] for item in secrets[:60]),
        "",
        "самые редкие загадки:",
        "  " + ", ".join(item["t"] for item in secrets[-40:]),
        "",
        "редкий край словаря:",
        "  " + ", ".join(words[-40:]),
        "",
        *show("примеры:", pick_idx),
        "",
        "формы:",
        *form_report,
        "",
        f"готово за {time.time() - started:.0f} с",
    ]
    report = "\n".join(lines) + "\n"
    (CACHE / "qa.txt").write_text(report, encoding="utf-8")
    print(report)
    # Молчаливый контроль: подсказки не должны быть обсценными и должны быть в словаре.
    for item in secrets:
        if not clear_noun(morph, item["t"]):
            raise SystemExit(f"загадка не существительное: {item['t']}")
        for pos in item["h"]:
            hint = words[item["n"][pos]]
            if obscene(hint) or hint in vague or not clear_noun(morph, hint):
                raise SystemExit(f"плохая подсказка у «{item['t']}»: {hint}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
