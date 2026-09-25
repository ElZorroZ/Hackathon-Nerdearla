export function RoomSelector({
  rooms,
  selected,
  onSelect,
}: {
  rooms: string[];
  selected: string;
  onSelect: (room: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {rooms.map((room) => (
        <button
          key={room}
          onClick={() => onSelect(room)}
          className={`px-4 py-2 rounded-lg font-medium transition-all capitalize ${
            selected === room
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
              : "bg-[#1a1a2e] text-gray-400 hover:bg-[#252540] hover:text-gray-200"
          }`}
        >
          {room.replace("-", " ")}
        </button>
      ))}
    </div>
  );
}
