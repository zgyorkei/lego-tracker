import fs from 'fs';

let content = fs.readFileSync('src/components/SetCard.tsx', 'utf8');

const regex1 = /<p className="text-sm font-black text-gray-700 tracking-tight">\{priceData\.priceHuf \? formatPrice\(priceData\.priceHuf\) : '-'\}(\s*)<\/p>/g;
content = content.replace(regex1, '<p className={`text-sm font-black ${isGreatDeal ? "text-green-900" : "text-gray-700"} tracking-tight`}>{priceData.priceHuf ? formatPrice(priceData.priceHuf) : "-"}$1</p>');

const regex2 = /<div className={`text-\[10px\] font-bold flex items-center gap-0\.5 \$\{\(priceData\.priceHuf && calculateDiff\(priceData\.priceHuf\) <= 0\) \? 'text-green-500' : 'text-red-500'\}`}>\s*\{priceData\.priceHuf \? calculateDiff\(priceData\.priceHuf\)\.toFixed\(1\) : 0\}% \s*\{\(priceData\.priceHuf && calculateDiff\(priceData\.priceHuf\) <= 0\) \? <TrendingDown size=\{10\} \/> : <TrendingUp size=\{10\} \/>\}\s*<\/div>/g;
content = content.replace(regex2, `<div className={\`text-[10px] font-bold flex items-center gap-0.5 \${(priceData.priceHuf && priceDiff <= 0) ? (isGreatDeal ? 'text-green-900 bg-green-200 px-1 rounded' : 'text-green-500') : 'text-red-500'}\`}>\n                              {priceData.priceHuf ? priceDiff.toFixed(1) : 0}% \n                              {(priceData.priceHuf && priceDiff <= 0) ? <TrendingDown size={10} /> : <TrendingUp size={10} />}\n                           </div>`);

fs.writeFileSync('src/components/SetCard.tsx', content);
console.log("Replaced");
