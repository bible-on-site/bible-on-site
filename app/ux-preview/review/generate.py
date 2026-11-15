"""Build the static HTML and GitHub-rendered comparison from one review catalog."""

from html import escape
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PR_URL = "https://github.com/bible-on-site/bible-on-site/pull/3385"
NOTICE = 'ענף ביקורת מתמשך. ה-PR נשאר בטיוטה. אין למזג או להפעיל מיזוג אוטומטי בלי הוראה מפורשת מדורד.'


def picture(side, filename, caption):
    """Use the original capture dimensions to keep lazy-loaded anchors stable."""
    path = f"assets/{side}/{filename}"
    if not (ROOT / path).is_file():
        raise FileNotFoundError(path)
    return f'<img width="1080" height="2400" src="{escape(path)}" alt="{escape(caption)}" loading="lazy">'


def main():
    catalog = json.loads((ROOT / "comparisons.json").read_text(encoding="utf-8"))
    comparisons = catalog["comparisons"]
    baseline = f'{catalog["baseline_branch"]} / {catalog["baseline_commit"][:9]}'
    intro = (
        'כל צילומי ה"לפני" הם מהענף הראשי של המאגר, ולא מאיטרציות קודמות בענף ה-UX. '
        'מימין: המצב הקיים. משמאל: ההצעה הנוכחית. '
        'כל הצילומים והסרטונים נלקחו מהאפליקציה האמיתית באמולטור Android.'
    )
    nav = ''.join(f'<a href="#{escape(item["id"])}">{escape(item["label"])}</a>' for item in comparisons)
    sections = []
    markdown = [
        '# על הפרק - לפני ואחרי מול הענף הראשי', '', NOTICE, '',
        f'[PR #3385]({PR_URL}) · [גלריית HTML בדפדפן](index.html) · [המסכים הנוכחיים](current.html)', '', intro, '',
        f'בסיס צילומי "לפני": `{baseline}`. עודכן: {catalog["updated"]}.', '',
        'הכרטיס היומי נשאר במרכז הבית. הספרייה היא מסך נוסף. צילומי "אחרי" מתעדכנים באותם שמות קבצים; היסטוריית האיטרציות נשמרת ב-Git.', '',
        'GitHub מציג את ה-Markdown כתוכן מעוצב ותומך ב-rich diff ב-Files changed. ה-HTML נשמר כקוד ונפתח מקומית עם קובצי ה-CSS וה-assets.', ''
    ]
    for number, item in enumerate(comparisons, 1):
        before = picture('before', item['before'], item['before_caption'])
        after = picture('after', item['after'], item['after_caption'])
        figures = []
        for side, img in [('before', before), ('after', after)]:
            label = 'לפני - הענף הראשי' if side == 'before' else 'אחרי - הצעת UX'
            figures.append(
                f'<figure class="{side}"><figcaption>{label}</figcaption><div class="phone">{img}</div>'
                f'<p class="caption">{escape(item[side + "_caption"])}</p></figure>'
            )
        sections.append(
            f'<article id="{escape(item["id"])}">\n'
            f'  <div class="section-head"><span class="number">{number:02}</span><h2>{escape(item["title"])}</h2></div>\n'
            f'  <p class="change">{escape(item["description"])}</p>\n'
            f'  <div class="pair" dir="rtl">\n    {figures[0]}\n    {figures[1]}\n  </div>\n</article>'
        )
        markdown.extend([
            f'## {item["title"]}', '', item['description'], '',
            '<table dir="rtl">', '<thead><tr><th align="right">לפני - הענף הראשי</th><th align="right">אחרי - הצעת UX</th></tr></thead>',
            '<tbody><tr>',
            f'<td align="right">{before.replace("width=\"1080\" height=\"2400\"", "width=\"300\"")}<br>{escape(item["before_caption"])}</td>',
            f'<td align="right">{after.replace("width=\"1080\" height=\"2400\"", "width=\"300\"")}<br>{escape(item["after_caption"])}</td>',
            '</tr></tbody></table>', ''
        ])
    sections.append(f'''<article id="motion">
  <div class="section-head"><span class="number">{len(comparisons) + 1:02}</span><h2>גלילה בתנועה - master מול הצעת ה-UX</h2></div>
  <p class="change">הקלטות אמיתיות מהאפליקציה. בהצעה החדשה יש הפסקות בין הגרירות כדי להדגים את ההשהיה, הדעיכה והחזרה.</p>
  <div class="pair" dir="rtl">
    <figure><figcaption>לפני - הענף הראשי</figcaption>
      <video controls muted playsinline preload="metadata" src="assets/before/reader-scroll.mp4"></video></figure>
    <figure class="after"><figcaption>אחרי - הצעת UX</figcaption>
      <video controls muted playsinline preload="metadata" src="assets/after/reader-scroll.mp4"></video></figure>
  </div>
</article>''')
    markdown.extend([
        '## גלילה בתנועה', '',
        '[לפני - master](assets/before/reader-scroll.mp4) · [אחרי - הצעת UX](assets/after/reader-scroll.mp4)', '',
        'הקלטות מסך אמיתיות. בהצעה החדשה יש הפסקות בין הגרירות כדי להדגים את ההשהיה, הדעיכה והחזרה.', '',
        '## עדכון הביקורת', '',
        ('מעדכנים את צילומי `assets/after/` ואת התיאורים ב-`comparisons.json`, ואז מריצים `python generate.py`. '
         'צילומי ה-`before` חייבים להישאר מהענף הראשי, עם קומיט בסיס מתועד. '
         'לא מציבים צילום מאיטרציה קודמת של ענף ה-UX בעמודת "לפני".'), ''
    ])
    html = f'''<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>על הפרק - לפני ואחרי מול הענף הראשי</title>
  <link rel="stylesheet" href="review.css">
</head>
<body>
<header>
  <div class="eyebrow">על הפרק / ביקורת חוויית משתמש / מול הענף הראשי</div>
  <h1>הפרק היומי במרכז.<br>עוד עולמות מסביב.</h1>
  <p class="intro">{escape(intro)}</p>
  <div class="notice">{escape(NOTICE)}</div>
  <div class="meta"><span>עודכן: {catalog['updated']}</span><span>בסיס: <bdi>{baseline}</bdi></span>
    <a href="{PR_URL}">הדיון ב-PR #3385</a><a href="REVIEW.md">ההשוואה ב-GitHub</a>
    <a href="current.html">המסכים הנוכחיים</a></div>
</header>
<nav aria-label="מעבר בין ההשוואות"><div class="nav-inner">{nav}<a href="#motion">וידאו גלילה</a></div></nav>
<main>
<!-- Generated from comparisons.json. Before always refers to the documented default-branch commit. -->
{chr(10).join(sections)}
</main>
<footer>לצפייה מקומית פותחים את index.html עם קובצי ה-CSS וה-assets. לביקורת ב-GitHub פותחים את REVIEW.md. אין למזג את ענף הביקורת.</footer>
</body>
</html>
'''
    (ROOT / 'index.html').write_text(html, encoding='utf-8')
    (ROOT / 'REVIEW.md').write_text('\n'.join(markdown), encoding='utf-8')
    print(f'Generated {len(comparisons)} comparisons against {baseline}')


if __name__ == '__main__':
    main()
