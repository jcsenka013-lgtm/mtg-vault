import { useEffect, useState } from "react";

export function useDeckStats(deckList: Map<string, { card: any; quantity: number; zone: string }>) {
    const [curve, setCurve] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0]);
    const [colors, setColors] = useState<{ [key: string]: number }>({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    const [creatureCount, setCreatureCount] = useState(0);
    const [spellCount, setSpellCount] = useState(0);

    useEffect(() => {
        const newCurve = [0, 0, 0, 0, 0, 0, 0, 0];
        const newColors = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        let creatures = 0;
        let spells = 0;

        deckList.forEach((item) => {
            const card = item.card;
            // Count CMC
            const cmc = card.cmc || 0;
            if (cmc >= 7) {
                newCurve[7] += item.quantity;
            } else {
                newCurve[cmc] += item.quantity;
            }

            // Count colors
            if (card.colors) {
                card.colors.forEach(color => {
                    newColors[color] = (newColors[color] || 0) + item.quantity;
                });
            } else {
                newColors.C += item.quantity;
            }

            // Count card types
            if (card.type_line?.toLowerCase().includes("creature")) {
                creatures += item.quantity;
            } else {
                spells += item.quantity;
            }
        });

        setCurve(newCurve);
        setColors(newColors);
        setCreatureCount(creatures);
        setSpellCount(spells);
    }, [deckList]);

    return { curve, colors, creatureCount, spellCount };
}