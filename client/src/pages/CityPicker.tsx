import { CITIES } from "@shared/cities";

export default function CityPicker() {
  const cities = Object.values(CITIES);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#F5EDD9] px-4 py-12">
      <div className="bg-[#25391D] rounded-2xl px-6 py-4 mb-8">
        <img src="/detour-logo-white.svg" alt="Detour" className="h-8 w-auto" />
      </div>

      <h1
        className="text-3xl md:text-4xl font-semibold italic text-[#25391D] text-center"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Which city are you running?
      </h1>
      <p
        className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#25391D]/60"
        style={{ fontFamily: "var(--font-body)" }}
      >
        Off the beaten path
      </p>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl">
        {cities.map((c) => (
          <a
            key={c.slug}
            href={`/${c.slug}`}
            className="group bg-[#25391D] rounded-2xl p-8 text-center shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            <h2
              className="text-2xl font-semibold italic text-[#F5EDD9]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {c.name}
            </h2>
            <p className="mt-2 text-sm text-[#F5EDD9]/70">
              {c.displayName}
            </p>
            <span className="mt-4 inline-block text-xs font-semibold uppercase tracking-wider text-[#F5EDD9] group-hover:underline">
              Start tracking →
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
