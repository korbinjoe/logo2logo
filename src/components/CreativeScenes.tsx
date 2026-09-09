const pieces: Record<string, string> = {
  arcade: `<rect x="47" y="26" width="356" height="270" rx="44" fill="#1f47db" stroke="#142854" stroke-width="5"/><rect x="70" y="47" width="308" height="166" rx="16" fill="#bdeac9" stroke="#142854" stroke-width="12"/><path d="M104 153h24v-24h24v-24h24v-24h24v24h24v24h24v24h24v24h-48v-24h-48v24h-72Z" fill="#1c413c"/><path d="M286 76h18v18h18v18h-18v18h-18v-18h-18V94h18Z" fill="#1c413c"/><path d="M310 157h26v26h-26Z" fill="#659e75"/><path d="M110 229h20v-17h21v17h20v21h-20v20h-21v-20h-20Z" fill="#10213f"/><circle cx="320" cy="244" r="18" fill="#fc764f" stroke="#142854" stroke-width="4"/><circle cx="274" cy="256" r="13" fill="#fdc928" stroke="#142854" stroke-width="4"/><path d="m203 243 18-3m-18 14 18-3" stroke="#98b9ff" stroke-width="5" stroke-linecap="round"/><path d="M413 131v47h19v30" fill="none" stroke="#142854" stroke-width="9" stroke-linecap="round"/>`,
  editorial: `<rect x="65" y="20" width="310" height="280" fill="#dc442f"/><path d="M195 52h50v60l45-44 36 35-46 44h62v49h-63l47 44-36 36-45-46v61h-50v-62l-44 47-37-36 48-44H98v-49h63l-47-44 36-35 45 44Z" fill="#f6f1e7"/><circle cx="221" cy="173" r="25" fill="#dc442f"/><path d="M65 315h220m22 0h68" stroke="#211d18" stroke-width="2"/>`,
  orbital: `<defs><radialGradient id="orbit-sphere" cx=".3" cy=".2"><stop stop-color="#f7fbff"/><stop offset=".4" stop-color="#7e94b6"/><stop offset=".8" stop-color="#243754"/><stop offset="1" stop-color="#101728"/></radialGradient></defs><circle cx="240" cy="158" r="98" fill="url(#orbit-sphere)"/><g fill="none" stroke="#9dadc4"><ellipse cx="240" cy="165" rx="204" ry="55" transform="rotate(-25 240 165)"/><ellipse cx="240" cy="165" rx="156" ry="127" transform="rotate(28 240 165)" opacity=".32"/><circle cx="240" cy="165" r="143" opacity=".16"/></g><g fill="#d4fb9d"><circle cx="80" cy="233" r="7"/><circle cx="375" cy="54" r="3"/><path d="M395 240v20m-10-10h20M81 85v14m-7-7h14" stroke="#d4fb9d"/></g><path d="M260 36h70l30-22" fill="none" stroke="#75839a" stroke-dasharray="3 4"/>`,
  bauhaus: `<rect x="34" y="25" width="390" height="270" fill="#e7c644"/><path d="M34 295V25h135a135 135 0 0 1 0 270Z" fill="#d63e26"/><path d="M304 25h120v270H304Z" fill="#244aaa"/><circle cx="169" cy="160" r="78" fill="#f0ede3"/><path d="M34 295 169 160l135 135Z" fill="#22231f"/><circle cx="364" cy="85" r="39" fill="#e7c644"/><circle cx="364" cy="173" r="39" fill="#f0ede3"/><circle cx="364" cy="261" r="25" fill="#d63e26"/>`,
  collage: `<g transform="rotate(-9 190 170)"><path d="M48 39 317 28l8 272-281 8Z" fill="#2b4bb6"/><path d="m175 70 24 55 59-29-20 62 60 16-57 25 25 58-60-22-23 57-20-56-61 21 24-58-59-25 60-17-17-64 58 31Z" fill="#eeb494"/><circle cx="185" cy="181" r="28" fill="#f6efd9"/></g><g transform="rotate(13 340 234)"><rect x="278" y="147" width="136" height="149" fill="#edda49"/><path d="M300 177h90m-90 12h90m-90 12h45" stroke="#29396b" stroke-width="3"/><path d="m310 250 20 17 57-47" fill="none" stroke="#29396b" stroke-width="9" stroke-linecap="round"/></g><path d="m106 22 71-5 7 31-70 7Z M294 276l61 18-8 25-61-18Z" fill="#cdbf9388"/>`,
  cinema: `<defs><radialGradient id="cinema-glow"><stop stop-color="#bb834c" stop-opacity=".32"/><stop offset="1" stop-color="#171313" stop-opacity="0"/></radialGradient></defs><ellipse cx="240" cy="170" rx="210" ry="160" fill="url(#cinema-glow)"/><g fill="none" stroke="#d4b28b" stroke-width="2"><circle cx="236" cy="155" r="101"/><circle cx="236" cy="155" r="92"/><path d="M145 200 237 65l91 135Z M160 215h153M236 65v181"/><circle cx="236" cy="155" r="30"/><path d="M108 284h257m-242 7h227"/></g><g fill="#d4b28b"><circle cx="236" cy="65" r="5"/><circle cx="145" cy="200" r="5"/><circle cx="328" cy="200" r="5"/></g>`,
};

export function CreativeScenes() {
  return (
    <div className="scene-art" aria-hidden="true">
      {Object.entries(pieces).map(([theme, piece]) => (
        <svg
          key={theme}
          viewBox="0 0 480 340"
          className={`scene-${theme}`}
          dangerouslySetInnerHTML={{ __html: piece }}
        />
      ))}
    </div>
  );
}
