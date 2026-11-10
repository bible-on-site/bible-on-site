import { describe, expect, it } from "vitest";
import { hasBulletinArticleText } from "~/lib/bulletin-article";

describe("written bulletin article content", () => {
	it("accepts written content when no separate title is supplied", () => {
		expect(hasBulletinArticleText("<p>תוכן כתוב</p>")).toBe(true);
	});
	it.each([
		null,
		"",
		"  ",
		"<p>&nbsp;&#160; &#x200f;</p>",
		"<h1>שיעור</h1><h2>לצפייה</h2><h2>להאזנה</h2>",
		'<h1>שיעור</h1><h2>להאזנה</h2><audio controls><source src="lesson.opus"><a href="lesson.opus">להאזנה לשיעור</a></audio>',
		'<h1>שיעור</h1><h2>לצפייה</h2><video controls><source src="lesson.webm">דפדפן זה אינו תומך בסרטון</video>',
		'<h1>שיעור</h1><iframe src="https://www.youtube.com/embed/example">חלופה לנגן</iframe>',
		'<object data="lesson.mp4">חלופה לנגן</object><embed src="lesson.mp3">',
		'<p><a href="lesson.MP3?download=1">השיעור המלא</a></p>',
		'<p><a href="https://youtu.be/example">השיעור המלא</a></p>',
		'<p><a href="https://player.vimeo.com/video/example">השיעור המלא</a></p>',
		'<p><a href="https://www.youtube-nocookie.com/embed/example">השיעור המלא</a></p>',
		'<p><a href="lesson.pdf">להורדת השיעור</a></p>',
		"<p>להאזנה לשיעור לחצו כאן</p><p>לצפיה בסרטון</p>",
		'<p>להאזנה לשיעור המלא</p><audio src="lesson.opus"></audio>',
		'<p>לצפייה בסרטון המלא לחצו כאן</p><video src="lesson.webm"></video>',
		'<p>לחצו על הקישור להאזנה להקלטה המלאה</p><audio src="lesson.opus"></audio>',
		'<p>Listen to the full lesson</p><audio src="lesson.opus"></audio>',
		'<p>ניתן להאזין לשיעור המלא</p><audio src="lesson.opus"></audio>',
		"<p>שיעור</p>",
		"<script>תוכן שאינו מודפס</script><style>body { color: red }</style><!-- תוכן -->",
		"<template><p>תוכן שאינו מודפס</p></template><noscript>תוכן חלופי</noscript><svg><text>כותרת</text></svg>",
		"<div hidden><p>תוכן מוסתר</p></div>",
		"<audio src=lesson.mp3></audio><p>באדיבות הרב</p><p>כל הזכויות שמורות</p>",
		"<p>123 - !</p><img src=portrait.png alt='תיאור התמונה'>",
	])("excludes a title/player/link-only entry: %s", (html) => {
		expect(hasBulletinArticleText(html, "שיעור")).toBe(false);
	});
	it.each([
		"<h1>מאמר</h1><p>תוכן כתוב.</p>",
		"טקסט כתוב ללא תגיות",
		"<p>רעיון קצר</p>",
		'<h1>שיעור</h1><audio src="lesson.opus"></audio><p>הסבר כתוב לצד ההקלטה.</p>',
		'<video src="lesson.webm"></video><blockquote>ביאור כתוב</blockquote>',
		'<p>רעיון <b>כתוב</b> עם <a href="/929/311">מקור</a>.</p>',
		'<p><a href="/929/311">ביאור כתוב</a></p>',
		'<p><a href="http://[">ביאור כתוב גם בקישור פגום</a></p>',
		"<p><a>ביאור כתוב</a></p>",
		"<div><p>לצפייה</p><p>האזנה לדבר ה' היא נושא הפרק.</p></div>",
		'<audio src="lesson.opus"></audio><p>צפייה בשיעור המלא מלמדת על דרכו של הנביא.</p>',
		"<p>שיעור</p><div>רעיון כתוב אחרי הכותרת</div>",
		"<table><tr><td>רעיון</td><td>כתוב</td></tr></table>",
		"<p>&#1514;&#1493;&#1499;&#1503; כתוב</p>",
	])(
		"keeps written content regardless of author or accompanying media: %s",
		(html) => {
			expect(hasBulletinArticleText(html, "שיעור")).toBe(true);
		},
	);
});
