-- Database selection handled by the executing tool (db-populator, Lambda, etc.)

-- Representative test data for tanah_author
INSERT INTO tanah_author (NAME, DETAILS) VALUES
('הרב לדוגמא שליט"א', 'תיאור לדוגמא'),
('הרב לדוגמא ז"ל', 'תיאור לדוגמא'),
('הרב לדוגמא הי"ד', 'תיאור לדוגמא'),
('רב עם תיאור ארוך ז"ל', 'תיאור מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד ארוך');

-- Representative test data for tanah_article
INSERT INTO tanah_article (PEREK_ID, AUTHOR_ID, ABSTRACT, NAME, PRIORITY, CONTENT) VALUES
(1, 1, '<h1>מאמר של הרב לדוגמא שליט"א על בראשית א</h1>', 'מאמר של הרב לדוגמא על בראשית א', 1, '<p>זהו תוכן המאמר המלא. בראשית ברא אלהים את השמים ואת הארץ.</p>'),
(1, 2, '<h1>מאמר של הרב לדוגמא ז"ל על בראשית א</h1>', 'מאמר של הרב לדוגמא ז"ל על בראשית א', 1, NULL),
(1, 2, '<h1>מאמר שני של הרב לדוגמא ז"ל על בראשית א</h1>', 'מאמר שני של הרב לדוגמא ז"ל על בראשית א', 1, NULL);
