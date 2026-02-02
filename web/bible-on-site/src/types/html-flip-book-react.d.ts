declare module "html-flip-book-react" {
  export interface PageSemantics {
    isFirstPage: boolean;
    isLastPage: boolean;
    pageIndex: number;
  }

  export interface FlipBookProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    startPage?: number;
    width?: number;
    height?: number;
    size?: "fixed" | "stretch";
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    startZIndex?: number;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    swipeDistance?: number;
    showPageCorners?: boolean;
    disableFlipByClick?: boolean;
    onFlip?: (e: { data: number }) => void;
    onChangeOrientation?: (e: { data: "portrait" | "landscape" }) => void;
    onChangeState?: (e: { data: string }) => void;
    onInit?: (e: { data: unknown }) => void;
    onUpdate?: (e: { data: unknown }) => void;
  }

  export interface FlipBookRef {
    pageFlip: () => {
      flipNext: () => void;
      flipPrev: () => void;
      flip: (page: number) => void;
      turnToPage: (page: number) => void;
      turnToNextPage: () => void;
      turnToPrevPage: () => void;
      getCurrentPageIndex: () => number;
      getPageCount: () => number;
      getOrientation: () => "portrait" | "landscape";
      getBoundsRect: () => DOMRect;
      destroy: () => void;
    };
  }

  const HTMLFlipBook: React.ForwardRefExoticComponent<
    FlipBookProps & React.RefAttributes<FlipBookRef>
  >;
  export default HTMLFlipBook;
}
