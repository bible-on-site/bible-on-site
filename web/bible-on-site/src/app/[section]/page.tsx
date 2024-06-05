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
              <a href="/929/" className="flex items-center space-x-2">
                <svg
                  className={styles.icon}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="white"
                  width="2em"
                  height="2em"
                  viewBox="0 0 448 512"
                >
                  <path d="M112 368h96c8.8 0 16-7.2 16-16v-96c0-8.8-7.2-16-16-16h-96c-8.8 0-16 7.2-16 16v96c0 8.8 7.2 16 16 16zM400 64h-48V16c0-8.8-7.2-16-16-16h-32c-8.8 0-16 7.2-16 16v48H160V16c0-8.8-7.2-16-16-16h-32c-8.8 0-16 7.2-16 16v48H48C21.5 64 0 85.5 0 112v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48zm0 394c0 3.3-2.7 6-6 6H54c-3.3 0-6-2.7-6-6V160h352v298z"></path>
                </svg>
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
              <svg
                className={styles.icon}
                xmlns="http://www.w3.org/2000/svg"
                fill="white"
                width="2em"
                height="2em"
                viewBox="0 0 320 512"
              >
                <path d="M192 416c0 17.7-14.3 32-32 32s-32-14.3-32-32 14.3-32 32-32 32 14.3 32 32zm48-60V92c0-6.6-5.4-12-12-12H92c-6.6 0-12 5.4-12 12v264c0 6.6 5.4 12 12 12h136c6.6 0 12-5.4 12-12zm80-308v416c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V48C0 21.5 21.5 0 48 0h224c26.5 0 48 21.5 48 48zm-48 410V54c0-3.3-2.7-6-6-6H54c-3.3 0-6 2.7-6 6v404c0 3.3 2.7 6 6 6h212c3.3 0 6-2.7 6-6z"></path>
              </svg>
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
