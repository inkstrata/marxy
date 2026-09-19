
  <img alt="logo" />
  <h1>widgetlib</h1>
  <p><strong>Fast, tiny widgets for the terminal and the browser.</strong></p>
  <a href="https://example.invalid/ci"><img alt="build" /></a>
  <a href="https://example.invalid/npm"><img alt="npm" /></a>
  <img alt="MIT" />

<h2 data-marxy-s="496" data-marxy-e="506">Install</h2>
<pre data-marxy-s="508" data-marxy-e="536"><code class="language-sh" data-marxy-s="514" data-marxy-e="533">pnpm add widgetlib
</code></pre>
<blockquote data-marxy-s="538" data-marxy-e="615">
<p data-marxy-s="540" data-marxy-e="615"><strong data-marxy-s="540" data-marxy-e="548">Note</strong>
Node 20 or later is required. Bun works but is not tested in CI.</p>
</blockquote>
<h2 data-marxy-s="617" data-marxy-e="625">Usage</h2>
<pre data-marxy-s="627" data-marxy-e="748"><code class="language-ts" data-marxy-s="633" data-marxy-e="745">import { widget } from 'widgetlib';

const w = widget({ title: 'Hello', width: 40 });
w.render(process.stdout);
</code></pre>
<h3 data-marxy-s="750" data-marxy-e="761">Options</h3>
<table data-marxy-s="763" data-marxy-e="1043">
<thead>
<tr data-marxy-s="763" data-marxy-e="804">
<th data-marxy-s="763" data-marxy-e="772">Option</th>
<th data-marxy-s="772" data-marxy-e="779">Type</th>
<th data-marxy-s="779" data-marxy-e="789">Default</th>
<th data-marxy-s="789" data-marxy-e="804">Description</th>
</tr>
</thead>
<tbody>
<tr data-marxy-s="847" data-marxy-e="903">
<td data-marxy-s="847" data-marxy-e="857"><code data-marxy-s="849" data-marxy-e="856">title</code></td>
<td data-marxy-s="857" data-marxy-e="868"><code data-marxy-s="859" data-marxy-e="867">string</code></td>
<td data-marxy-s="868" data-marxy-e="875"><code data-marxy-s="870" data-marxy-e="874">""</code></td>
<td data-marxy-s="875" data-marxy-e="903">Title shown in the frame</td>
</tr>
<tr data-marxy-s="904" data-marxy-e="968">
<td data-marxy-s="904" data-marxy-e="914"><code data-marxy-s="906" data-marxy-e="913">width</code></td>
<td data-marxy-s="914" data-marxy-e="925"><code data-marxy-s="916" data-marxy-e="924">number</code></td>
<td data-marxy-s="925" data-marxy-e="932"><code data-marxy-s="927" data-marxy-e="931">80</code></td>
<td data-marxy-s="932" data-marxy-e="968">Columns, clamped to the terminal</td>
</tr>
<tr data-marxy-s="969" data-marxy-e="1043">
<td data-marxy-s="969" data-marxy-e="980"><code data-marxy-s="971" data-marxy-e="979">border</code></td>
<td data-marxy-s="980" data-marxy-e="1015"><code data-marxy-s="982" data-marxy-e="1014">'single' | 'double' | 'none'</code></td>
<td data-marxy-s="1015" data-marxy-e="1028"><code data-marxy-s="1017" data-marxy-e="1027">'single'</code></td>
<td data-marxy-s="1028" data-marxy-e="1043">Frame style</td>
</tr>
</tbody>
</table>
<h2 data-marxy-s="1045" data-marxy-e="1056">Features</h2>
<ul data-marxy-s="1058" data-marxy-e="1243">
<li data-marxy-s="1058" data-marxy-e="1077">Zero dependencies</li>
<li data-marxy-s="1078" data-marxy-e="1220">Works in
<ul data-marxy-s="1091" data-marxy-e="1220">
<li data-marxy-s="1091" data-marxy-e="1097">Node</li>
<li data-marxy-s="1100" data-marxy-e="1105">Bun</li>
<li data-marxy-s="1108" data-marxy-e="1220">the browser, via
<ul data-marxy-s="1131" data-marxy-e="1220">
<li data-marxy-s="1131" data-marxy-e="1153">a <code data-marxy-s="1135" data-marxy-e="1145">&lt;canvas&gt;</code> backend</li>
<li data-marxy-s="1158" data-marxy-e="1220">a DOM backend
<ul data-marxy-s="1180" data-marxy-e="1220">
<li data-marxy-s="1180" data-marxy-e="1220">with CSS custom properties for theming</li>
</ul></li>
</ul></li>
</ul></li>
<li data-marxy-s="1221" data-marxy-e="1243">Tiny: 3.1 kB gzipped</li>
</ul>

Why another widget library?
<p data-marxy-s="1303" data-marxy-e="1388">Because the existing ones are either enormous or abandoned. This one is neither, yet.</p>

<h2 data-marxy-s="1402" data-marxy-e="1417">Contributing</h2>
<ol data-marxy-s="1419" data-marxy-e="1528">
<li data-marxy-s="1419" data-marxy-e="1426">Fork</li>
<li data-marxy-s="1427" data-marxy-e="1444"><code data-marxy-s="1430" data-marxy-e="1444">pnpm install</code></li>
<li data-marxy-s="1445" data-marxy-e="1515">Make a change with a test
<ul data-marxy-s="1477" data-marxy-e="1515">
<li data-marxy-s="1477" data-marxy-e="1494">run <code data-marxy-s="1483" data-marxy-e="1494">pnpm test</code></li>
<li data-marxy-s="1498" data-marxy-e="1515">run <code data-marxy-s="1504" data-marxy-e="1515">pnpm lint</code></li>
</ul></li>
<li data-marxy-s="1516" data-marxy-e="1528">Open a PR</li>
</ol>
<h2 data-marxy-s="1530" data-marxy-e="1540">License</h2>
<p data-marxy-s="1542" data-marxy-e="1570">MIT © the widgetlib authors</p>
