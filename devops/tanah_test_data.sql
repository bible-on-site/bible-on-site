USE `tanah_test`;

-- Test data for table tanah_article
INSERT INTO tanah_article (PEREK_ID, AUTHOR_ID, ABSTRACT, NAME, PRIORITY) VALUES
(1, 1, '<h1>מאמר של הרב לדוגמא שליט"א על בראשית א</h1>', 'מאמר של הרב לדוגמא על בראשית א', 1),
(1, 2, '<h1>מאמר של הרב לדוגמא ז"ל על בראשית א</h1>', 'מאמר של הרב לדוגמא ז"ל על בראשית א', 1),
(1, 2, '<h1>מאמר שני של הרב לדוגמא ז"ל על בראשית א</h1>', 'מאמר שני של הרב לדוגמא ז"ל על בראשית א', 1);

-- Test data for table tanah_rabbi
INSERT INTO tanah_rabbi (NAME, DETAILS, ARTICLE_DETECTION_TYPE_ID) VALUES
('הרב לדוגמא שליט"א', 'תיאור לדוגמא', 1),
('הרב לדוגמא ז"ל', 'תיאור לדוגמא', 1),
('הרב לדוגמא הי"ד', 'תיאור לדוגמא', 1),
('רב עם תיאור ארוך ז"ל', 'תיאור מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד ארוך', 1);

-- Test data for table tanah_sefer
INSERT INTO tanah_sefer (SEFER_ID, NAME, TANACH_US_NAME) VALUES
(1, 'בראשית', 'Gen'),
(2, 'שמות', 'Ex'),
(3, 'ויקרא', 'Lev'),
(4, 'במדבר', 'Num'),
(5, 'דברים', 'Deut'),
(8, 'שמואל', '{"1":"1 Sam","2":"2 Sam"}'),
(34, 'עזרא', '{"70":"Ezra","50":"Neh"}');
