with open('src/components/Convert.tsx', 'r') as f:
    lines = f.readlines()

start_idx = -1
for i, l in enumerate(lines):
    if 'panelsHtml += `<div class="panel-box">' in l:
        start_idx = i
        break

if start_idx != -1:
    end_idx = -1
    for j in range(start_idx, start_idx + 15):
        if 'panelsHtml += `<div class="panel-text-container">' in lines[j]:
            end_idx = j + 2
            break
    if end_idx != -1:
        replacement = [
            '                   const panelTexts = p.texts || [];\n',
            '                   const panelTextHtml = panelTexts.length > 0\n',
            '                     ? `<div class="panel-text-container">${panelTexts.map((t: any) => `<p class="panel-text-line">${t.text.replace(/\\n/g, \' \')}</p>`).join(\'\')}</div>`\n',
            '                     : \'\';\n',
            '                   panelsHtml += `<div class="panel-box" style="page-break-inside: avoid; break-inside: avoid;"><img src="images/${panelImgFilename}" class="comic-img" alt="Panel ${pIdx + 1}" />${panelTextHtml}</div>\\n`;\n',
            '                }\n',
            '             }\n',
        ]
        lines = lines[:start_idx] + replacement + lines[end_idx:]
        with open('src/components/Convert.tsx', 'w') as f:
            f.writelines(lines)
        print('SUCCESS')
    else:
        print('End not found')
else:
    print('Start not found')
