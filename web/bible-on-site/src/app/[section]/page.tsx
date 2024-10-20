import Image from "next/image";
import styles from "./page.module.css";

// sections are a closed list.
export const dynamicParams = false;

// this reserverd function is a magic for caching
export function generateStaticParams() {
  return ["dailyBulletin", "tos", "app", "contact", "donation"].map(
    (section) => ({ section })
  );
}

export default async function Home({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  return (
    <div className={styles.page}>
      <section className={`${styles.alHaperekSection} bg-custom py-8`}>
        <header className="text-center">
          <h1 className="text-4xl font-bold">תנ&quot;ך על הפרק</h1>
          <h2 className="text-2xl mt-2">לימוד תנ&quot;ך יומי</h2>
        </header>
        <section
          className={`${styles.alHaperekHeadlines} grid grid-cols-1 md:grid-cols-2 gap-6 mt-8`}
        >
          <article className="flex flex-col items-center p-6 rounded-lg">
            <h1 className="text-xl font-bold">
              <a href="/929/">
                <Image
                  className="icon-white"
                  src="/icons/calendar-today.svg"
                  alt="עלון יומי"
                  width={48}
                  height={48}
                />
                <span>לימוד יומי על הפרק</span>
              </a>
            </h1>
            <p>
              בתנ&quot;ך על הפרק לומדים במקביל ללימוד של 929 - פרק ליום. הלימוד
              נעים, מעמיק ומחכים.
            </p>
          </article>
          <article className="flex flex-col items-center p-6 rounded-lg">
            <h1 className="text-xl font-bold">
              <Image
                className="icon-white"
                src="/icons/smartphone.svg"
                alt="עלון יומי"
                width={34}
                height={34}
              />
              <span>ישומון תנ&quot;ך על הפרק</span>
            </h1>
            <p>
              לתנ&quot;ך על הפרק ישנה אפליקציה לכל סוגי הסמארטפונים העיקריים.
              באפליקציה תוכלו ללמוד תנ&quot;ך בנוחות.
            </p>
          </article>
        </section>
      </section>
      {(await params).section}
    </div>
  );
}
