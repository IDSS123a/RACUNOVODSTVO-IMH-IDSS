# Fonts

`NotoSans-Regular-Latin.ttf` and `NotoSans-Bold-Latin.ttf` are subsets of Noto Sans 400/700
(SIL Open Font License 1.1, see `OFL.txt`; source: npm `@expo-google-fonts/noto-sans@0.4.2`).

They are pre-subset because pdf-lib's own subsetting drops glyphs (verified 2026-10-21), so the
invoice PDF embeds these small fonts whole (DL-P007). Regenerate with fontTools:

    python -m fontTools.subset NotoSans-Regular.ttf --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+0218-021B,U+2010-2015,U+2018-201E,U+2022,U+2026,U+2039-203A,U+20AC,U+2116,U+2192,U+2212" --layout-features='' --no-hinting --name-IDs='*' --output-file=NotoSans-Regular-Latin.ttf
