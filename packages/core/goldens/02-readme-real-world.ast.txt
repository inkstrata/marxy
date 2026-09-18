document [0,1571)
  htmlBlock [0,494) value="<div align=\"center\">\n  <img src=\"https://example.invalid/logo.png\" width=\"120\" alt=\"logo\">\n  <h1>widgetlib</h1>\n  <p><st…"
  heading [496,506) level=2
    text [499,506) value="Install"
  codeBlock [508,536) lang=sh info="sh" content=[514,533) value="pnpm add widgetlib"
  blockquote [538,615)
    paragraph [540,615)
      strong [540,548)
        text [542,546) value="Note"
      softBreak [548,551)
      text [551,615) value="Node 20 or later is required. Bun works but is not tested in CI."
  heading [617,625) level=2
    text [620,625) value="Usage"
  codeBlock [627,748) lang=ts info="ts" content=[633,745) value="import { widget } from 'widgetlib';\n\nconst w = widget({ title: 'Hello', width: 40 });\nw.render(process.stdout);"
  heading [750,761) level=3
    text [754,761) value="Options"
  table [763,1043) align=-,-,-,-
    tableRow [763,804) header=true
      tableCell [763,772)
        text [765,771) value="Option"
      tableCell [772,779)
        text [774,778) value="Type"
      tableCell [779,789)
        text [781,788) value="Default"
      tableCell [789,804)
        text [791,802) value="Description"
    tableRow [847,903) header=false
      tableCell [847,857)
        code [849,856) value="title"
      tableCell [857,868)
        code [859,867) value="string"
      tableCell [868,875)
        code [870,874) value="\"\""
      tableCell [875,903)
        text [877,901) value="Title shown in the frame"
    tableRow [904,968) header=false
      tableCell [904,914)
        code [906,913) value="width"
      tableCell [914,925)
        code [916,924) value="number"
      tableCell [925,932)
        code [927,931) value="80"
      tableCell [932,968)
        text [934,966) value="Columns, clamped to the terminal"
    tableRow [969,1043) header=false
      tableCell [969,980)
        code [971,979) value="border"
      tableCell [980,1015)
        code [982,1014) value="'single' | 'double' | 'none'"
      tableCell [1015,1028)
        code [1017,1027) value="'single'"
      tableCell [1028,1043)
        text [1030,1041) value="Frame style"
  heading [1045,1056) level=2
    text [1048,1056) value="Features"
  list [1058,1243) ordered=false tight=true
    listItem [1058,1077)
      paragraph [1060,1077)
        text [1060,1077) value="Zero dependencies"
    listItem [1078,1220)
      paragraph [1080,1088)
        text [1080,1088) value="Works in"
      list [1091,1220) ordered=false tight=true
        listItem [1091,1097)
          paragraph [1093,1097)
            text [1093,1097) value="Node"
        listItem [1100,1105)
          paragraph [1102,1105)
            text [1102,1105) value="Bun"
        listItem [1108,1220)
          paragraph [1110,1126)
            text [1110,1126) value="the browser, via"
          list [1131,1220) ordered=false tight=true
            listItem [1131,1153)
              paragraph [1133,1153)
                text [1133,1135) value="a "
                code [1135,1145) value="<canvas>"
                text [1145,1153) value=" backend"
            listItem [1158,1220)
              paragraph [1160,1173)
                text [1160,1173) value="a DOM backend"
              list [1180,1220) ordered=false tight=true
                listItem [1180,1220)
                  paragraph [1182,1220)
                    text [1182,1220) value="with CSS custom properties for theming"
    listItem [1221,1243)
      paragraph [1223,1243)
        text [1223,1243) value="Tiny: 3.1 kB gzipped"
  htmlBlock [1245,1301) value="<details>\n<summary>Why another widget library?</summary>"
  paragraph [1303,1388)
    text [1303,1388) value="Because the existing ones are either enormous or abandoned. This one is neither, yet."
  htmlBlock [1390,1400) value="</details>"
  heading [1402,1417) level=2
    text [1405,1417) value="Contributing"
  list [1419,1528) ordered=true tight=true start=1
    listItem [1419,1426)
      paragraph [1422,1426)
        text [1422,1426) value="Fork"
    listItem [1427,1444)
      paragraph [1430,1444)
        code [1430,1444) value="pnpm install"
    listItem [1445,1515)
      paragraph [1448,1473)
        text [1448,1473) value="Make a change with a test"
      list [1477,1515) ordered=false tight=true
        listItem [1477,1494)
          paragraph [1479,1494)
            text [1479,1483) value="run "
            code [1483,1494) value="pnpm test"
        listItem [1498,1515)
          paragraph [1500,1515)
            text [1500,1504) value="run "
            code [1504,1515) value="pnpm lint"
    listItem [1516,1528)
      paragraph [1519,1528)
        text [1519,1528) value="Open a PR"
  heading [1530,1540) level=2
    text [1533,1540) value="License"
  paragraph [1542,1570)
    text [1542,1570) value="MIT © the widgetlib authors"
