import Image from "next/image";
import styles from "./page.module.css";

// sections are a closed list.
export const dynamicParams = false;

// this reserverd function is a magic for caching
export async function generateStaticParams() {
  return ["dailyBulletin", "tos", "app", "contact", "donation"];
}

export default function Home({
  params: { section },
}: {
  params: { section: string };
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
            <h1 className="text-xl font-bold" role="button" tabIndex={1}>
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
      {section}
    </div>
  );
}

// // src/app/[section]/page.tsx

// import { useEffect } from "react";

// // This is a Server Component
// const Page = async ({ params }: { params: { section: string } }) => {
//   const { section } = params;

//   return <ClientComponent section={section} />;
// };

// // This is a Client Component
// const ClientComponent = ({ section }: { section: string }) => {
//   useEffect(() => {
//     console.log("Dynamic Section:", section);
//     // Perform actions with the dynamic section
//   }, [section]);

//   return (
//     <div>
//       <h1>Dynamic Section: {section}</h1>
//     </div>
//   );
// };

// export default Page;

// import { useEffect } from "react";
// import { useParams } from "next/navigation";

// const data = [
//   { Name: "John", Age: 29 },
//   { Name: "Doe", Age: 32 },
// ];

// const Home = () => {
//   const { section } = useParams();

//   useEffect(() => {
//     if (section && !Array.isArray(section)) {
//       document.getElementById(section)?.scrollIntoView({ behavior: "smooth" });
//     }
//   }, [section]);

//   return (
//     <div>
//       <div>
//         Hello World
//         {/* <DailyBulletin />
//         <GridSection />
//         <TermsOfService />
//         <MobileApp />
//         <Contact />
//         <Donations /> */}
//       </div>
//     </div>
//   );
// };

// export default Home;
