interface Props {
  unreadCount: number;
  preview: string;
  onClick: () => void;
}

export function TodayTasksCard({ unreadCount, preview, onClick }: Props) {
  const zero = unreadCount === 0;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3.5 text-left rounded-2xl border border-[#FFF6C7] bg-[#FFFBE6] px-[18px] py-4 mb-[18px] shadow-[0_1px_2px_rgba(25,25,25,.05)] transition hover:-translate-y-px hover:shadow-[0_12px_32px_rgba(25,25,25,.08)]"
    >
      <span className="flex-none w-[42px] h-[42px] rounded-xl bg-[#FEE500] text-[#191919] flex items-center justify-center text-xl">
        🔔
      </span>
      <div className="flex-1 min-w-0">
        <b className="flex items-center gap-2 text-[1.02rem] font-bold text-[#191919]">
          오늘 할 일
          <span
            className={
              'inline-flex items-center justify-center min-w-[22px] h-[22px] px-[7px] rounded-full text-[.78rem] font-extrabold ' +
              (zero ? 'bg-[#ECECEC] text-[#767676]' : 'bg-[#E0483C] text-white')
            }
          >
            {unreadCount}
          </span>
        </b>
        <span className="block mt-0.5 text-[.88rem] text-[#3C3C3C] truncate">{preview}</span>
      </div>
      <span className="flex-none text-[.9rem] font-bold text-[#B8860B]">자세히 ›</span>
    </button>
  );
}
