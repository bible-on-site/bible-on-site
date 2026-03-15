-- Legacy migration: Import entries from old תנכפדיה project
-- Source: C:\old laptop\source\tanah-project\תנכפדיה\אישים\
-- Entries: יהושע, עלי, שמשון

-- Lookup ID for MAIN name type
SET @main_name_type_id = (SELECT id FROM tanahpedia_lookup_name_type WHERE name = 'MAIN' LIMIT 1);

-- ═══════════════════════════════════════════════════════════
-- 1. יהושע בן נון
-- ═══════════════════════════════════════════════════════════

SET @yehoshua_person_id = UUID();
SET @yehoshua_entry_id = UUID();
SET @yehoshua_name_id = UUID();
SET @yehoshua_sex_id = UUID();
SET @yehoshua_entry_entity_id = UUID();

INSERT INTO tanahpedia_person (id) VALUES (@yehoshua_person_id);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id)
VALUES (@yehoshua_name_id, @yehoshua_person_id, 'יהושע בן נון', @main_name_type_id);

INSERT INTO tanahpedia_person_sex (id, person_id, sex)
VALUES (@yehoshua_sex_id, @yehoshua_person_id, 'MALE');

INSERT INTO tanahpedia_entry (id, unique_name, title, content) VALUES (
    @yehoshua_entry_id,
    'יהושע-בן-נון',
    'יהושע בן נון',
    '<p>יְהוֹשֻׁעַ בִּן נוּן, יד ימינו של&nbsp;<a href=\"משה\">משה</a><span style=\"vertical-align: super;\">*</span>&nbsp;וממשיך דרכו<span style=\"vertical-align: super;\">*</span>, מנהיגם של ישראל בכניסתם לארץ, נביא<span style=\"vertical-align: super;\">*</span>.</p>\n<hr>\n<h2 style=\"color: rgb(0, 0, 0);\">שמו</h2>\n<h3>מהושע ליהושע</h3>\n<p>נקרא בתחילה הוֹשֵׁעַ עד ש<a href=\"משה\">משה</a>&nbsp;החליף את שמו ליְהוֹשֻׁעַ<span style=\"vertical-align: super;\">*</span>. ורבותינו דרשו טעמים בהוספת אות יו\"ד לשמו:</p>\n<p>א. כברכה מ<a href=\"משה\">משה</a>, שהקב\"ה המכונה \'יה\', יושיעו מעצת עשרת המרגלים<span style=\"vertical-align: super;\">*</span>.</p>\n<p>ב. כנגד השכר שנטל במקום עשרת המרגלים האחרים שלא השלימו משימתם כראוי<span style=\"vertical-align: super;\">*</span>.</p>\n<p>ג. בתמורה לאות יו\"ד שנלקחה מ<a href=\"שרה\">שרה</a> אמנו<span style=\"vertical-align: super;\">*</span>.</p>\n<hr>\n<h2 style=\"color: rgb(0, 0, 0);\">חיבוריו</h2>\n<p>כתב את ספר יהושע<span style=\"vertical-align: super;\">*</span>.</p>\n<p>לפי דעה בגמרא<span style=\"vertical-align: super;\">*</span>&nbsp;כתב שמונה פסוקים בספר דברים.</p>\n<p>כמו כן חיבר את תפילת עלינו לשבח<span style=\"vertical-align: super;\">*</span>.</p>\n<hr>\n<h2>הערות</h2>\n<h6><span style=\"vertical-align: super;\">*</span>&nbsp;שמות לג יא<br><span style=\"vertical-align: super;\">*</span>&nbsp;במדבר כז<br><span style=\"vertical-align: super;\">*</span>&nbsp;יהושע א א ועוד; אבן עזרא דברים יח טו; רלב\"ג יהושע ה יג; זוהר בראשית כא:; שם משמואל ויחי תרע\"ה<br><span style=\"vertical-align: super;\">*</span>&nbsp;במדבר יג טז<br><span style=\"vertical-align: super;\">*</span>&nbsp;במדבר רבה פרשה טז אות ט<br><span style=\"vertical-align: super;\">*</span>&nbsp;שם שם שם<br><span style=\"vertical-align: super;\">*</span>&nbsp;ויקרא רבה פרשה יט אות ב בסוף; סנהדרין קז.<br><span style=\"vertical-align: super;\">*</span>&nbsp;בבא בתרא יד:<br><span style=\"vertical-align: super;\">*</span>&nbsp;בבא בתרא טו.<br><span style=\"vertical-align: super;\">*</span>&nbsp;תשובת רב האי גאון המובאת בשערי תשובה סימן מד. וכן בפירושי סידור התפילה לרוקח ([קלב] מלכיות עמודים תרנו-תרנז)</h6>'
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_type, entity_id)
VALUES (@yehoshua_entry_entity_id, @yehoshua_entry_id, 'PERSON', @yehoshua_person_id);

-- ═══════════════════════════════════════════════════════════
-- 2. עלי הכהן
-- ═══════════════════════════════════════════════════════════

SET @eli_person_id = UUID();
SET @eli_entry_id = UUID();
SET @eli_name_id = UUID();
SET @eli_sex_id = UUID();
SET @eli_entry_entity_id = UUID();

INSERT INTO tanahpedia_person (id) VALUES (@eli_person_id);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id)
VALUES (@eli_name_id, @eli_person_id, 'עלי הכהן', @main_name_type_id);

INSERT INTO tanahpedia_person_sex (id, person_id, sex)
VALUES (@eli_sex_id, @eli_person_id, 'MALE');

INSERT INTO tanahpedia_entry (id, unique_name, title, content) VALUES (
    @eli_entry_id,
    'עלי-הכהן',
    'עלי הכהן',
    '<p>עֵלִי הַכֹּהֵן, כֹּהֵן גדול, שופט.</p>\n<h2>ברכתו של כהן צדיק</h2>\n<p>בעת ששימש ככהן במשכן אשר בשילה, הגיעה להתפלל שם <a href=\"חנה\">חנה</a><span style=\"vertical-align: super;\">*</span>. לאחר דו שיח טעון מברך<span style=\"vertical-align: super;\">*</span>&nbsp;אותה עלי שה\' ימלא את בקשתה לפרי בטן, ואכן לאחר כחצי שנה<span style=\"vertical-align: super;\">*</span>&nbsp;נולד לה בנה הבכור, <a href=\"שמואל\">שמואל</a>.</p>\n<h2>מסירות נפשו בשפיטת עם ישראל</h2>\n<p>בתיאור פטירתו של עלי כתוב: \"כִּֽי־זָקֵ֥ן הָאִ֖ישׁ... וְה֛וּא שָׁפַ֥ט אֶת־יִשְׂרָאֵ֖ל אַרְבָּעִ֥ים שָׁנָֽה׃\"<span style=\"vertical-align: super;\">*</span>. ר\' יצחק אברבנאל מסביר<span style=\"vertical-align: super;\">*</span>&nbsp;שציון זקנתו ושפיטת ישראל נסמכו בכוונה באותו פסוק, שכן עלי מסר את הנפש באותן ארבעים שנה לשפוט את ישראל כראוי וגופו נחלש מהמאמץ.</p>\n<h2>סדר העדיפויות של אדם קדוש</h2>\n<p>לאחר הקרב הגרוע נגד פלשתים מבשרים לעלי על התבוסה ועל מות בניו, חָפְנִי ופִּינְחָס. רק כאשר עלי שומע שארון הא-להים נשבה הוא נופל ומת.</p>\n<h2>הביקורת של הקב\"ה כלפי עלי</h2>\n<p>במראה נבואה, מודיע הקב\"ה לשמואל הרמתי על ענשו הצפוי של עלי הכהן. הנימוק של ה\' להחלטה הרעה הזו היא התוכחה החלושה של עלי כלפי מעשיהם השליליים של בניו, חָפְנִי ופִּינְחָס.</p>\n<hr>\n<h2 style=\"color: rgb(0, 0, 0);\">הערות</h2>\n<h6 style=\"color: rgb(0, 0, 0);\"><span style=\"vertical-align: super;\">*</span>&nbsp;שמואל א א ט-יב<br><span style=\"vertical-align: super;\">*</span>&nbsp;שמואל א א יז<br><span style=\"vertical-align: super;\">*</span>&nbsp;ראש השנה יא א; יבמות מב.; נדה לח:<br><span style=\"vertical-align: super;\">*</span>&nbsp;שמואל א ג יח<br><span style=\"vertical-align: super;\">*</span>&nbsp;אברבנאל שמואל א ג יח</h6>'
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_type, entity_id)
VALUES (@eli_entry_entity_id, @eli_entry_id, 'PERSON', @eli_person_id);

-- ═══════════════════════════════════════════════════════════
-- 3. שמשון
-- ═══════════════════════════════════════════════════════════

SET @shimshon_person_id = UUID();
SET @shimshon_entry_id = UUID();
SET @shimshon_name_id = UUID();
SET @shimshon_sex_id = UUID();
SET @shimshon_entry_entity_id = UUID();

INSERT INTO tanahpedia_person (id) VALUES (@shimshon_person_id);

INSERT INTO tanahpedia_person_name (id, person_id, name, name_type_id)
VALUES (@shimshon_name_id, @shimshon_person_id, 'שמשון', @main_name_type_id);

INSERT INTO tanahpedia_person_sex (id, person_id, sex)
VALUES (@shimshon_sex_id, @shimshon_person_id, 'MALE');

INSERT INTO tanahpedia_entry (id, unique_name, title, content) VALUES (
    @shimshon_entry_id,
    'שמשון',
    'שמשון',
    '<p>שופט, נזיר מבטן.</p>\n<hr>\n<h2 style=\"color: rgb(0, 0, 0);\">שמו</h2>\n<h3>שֶׁמֶשׁ וּמָגֵן</h3>\n<p>על פי דברי ר\' יוחנן בגמרא<span style=\"vertical-align: super;\">*</span>&nbsp;נקרא כך משום תכונתו להיות מָגֵן לעם ישראל כמו רבונו של עולם.</p>\n<h3>שַׁמָּשׁ</h3>\n<p>ר\' יצחק&nbsp;אַבְּרַבַנְאֵל בפירושו הראשון<span style=\"vertical-align: super;\">*</span>&nbsp;לשמו של שמשון, מציע שנקרא כך על שם ייעודו לשמש את ישראל.</p>\n<h3 style=\"color: rgb(0, 0, 0);\">שִׁמְשׁוֹן מלשון שְׁמָמָה</h3>\n<p>בפירושו השני<span style=\"vertical-align: super;\">*</span>&nbsp;לשמו של שמשון, כותב ר\' יצחק אַבְּרַבַנְאֵל שנקרא כך לרמוז על השממה הגדולה העתידה לפלשתים, אשר שמשון נלחם בהם.</p>\n<hr>\n<h2>נזירותו</h2>\n<h3 style=\"color: rgb(0, 0, 0);\">הגורמים</h3>\n<p>בענין הסיבה להוראת ה\' על נזירות שמשון נאמרו מספר טעמים:</p>\n<p>א. משום<span style=\"vertical-align: super;\">*</span>&nbsp;שהיה גלוי לפני מי שאמר והיה העולם שיצרו של שמשון עתיד למשוך אותו ולהטעות אותו אחר הנשים, חיסן אותו על ידי הזרתו מהיין. וכדברי חז\"ל שנזירות יין מועילה לצמצום יצר העריות: \'הרואה סוטה בקלקולה יזיר עצמו מן היין\'<span style=\"vertical-align: super;\">*</span>.</p>\n<p>ב. כדי<span style=\"vertical-align: super;\">*</span>&nbsp;לקדש אותו ולהבדיל אותו לגדול ולהיות ההיפך מהדגם של הפשתים האוכלים מאכלים טמאים וסובאי יין. ובזאת תזרום שנאה בדמו של שמשון אשר תניעו להלחם ולנקום בם נקמת ה\'.</p>\n<p>ג. מאחר<span style=\"vertical-align: super;\">*</span>&nbsp;שמעשיו של שמשון היו לעתים תמוהים מאוד, רצה הקב\"ה למנוע את האפשרות להלעיז על שמשון שעשה מעשים אלו מתוך שכרות.</p>\n<hr>\n<h2>הערות</h2>\n<h6><span style=\"vertical-align: super;\">*</span>&nbsp;סוטה י.<br><span style=\"vertical-align: super;\">*</span>&nbsp;אברבנאל שופטים יג כד<br><span style=\"vertical-align: super;\">*</span>&nbsp;שם שם שם שם<br><span style=\"vertical-align: super;\">*</span>&nbsp;רלב\"ג שופטים יג ג<br><span style=\"vertical-align: super;\">*</span>&nbsp;ברכות סג.; סוטה ב.<br><span style=\"vertical-align: super;\">*</span>&nbsp;אברבנאל שופטים יג ב<br><span style=\"vertical-align: super;\">*</span>&nbsp;שם שם שם שם</h6>'
);

INSERT INTO tanahpedia_entry_entity (id, entry_id, entity_type, entity_id)
VALUES (@shimshon_entry_entity_id, @shimshon_entry_id, 'PERSON', @shimshon_person_id);
