import { Bookshelf } from "@/app/components/Bookshelf";
import styles from "./page.module.css";

const BookshelfPage = () => {
	return (
		<div className={styles.page}>
			<Bookshelf />
		</div>
	);
};

export default BookshelfPage;
