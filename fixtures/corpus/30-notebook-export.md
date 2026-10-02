# Rooftop sensor readings: a first look

*Exploration notebook, exported with `jupyter nbconvert --to markdown`. Kernel: Python 3.12. The data are synthetic and were generated for this example; no real stations are involved.*

We want to know whether the sensor on the north roof drifts relative to the one on the south roof. The model is simple: if both sensors see the same air, the difference $\Delta T = T_N - T_S$ should have a mean close to zero, and any slow trend in it is drift. Write the drift rate as $\alpha$ degrees per week, so that over $n$ weeks we expect $\Delta T \approx \alpha n + \varepsilon$.

<div class="alert alert-block alert-info">
<b>Note:</b> every cell below was run top to bottom on a fresh kernel. Cell numbers in the margin of the original notebook were removed by the export.
</div>

## 1. Setup

Install the one package that is not in the base image, then import everything we need.


```python
!pip install --quiet tabulate==0.9.0
```

    WARNING: Running pip as the 'root' user can result in broken permissions and conflicting behaviour with the system package manager.
    Note: you may need to restart the kernel to use updated packages.



```python
import math
import random
import statistics
import warnings

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

warnings.simplefilter("default")
```

    /opt/conda/lib/python3.12/site-packages/pandas/core/computation/expressions.py:21: UserWarning: Pandas requires version '2.8.4' or newer of 'numexpr' (version '2.8.1' currently installed).
      from pandas.core.computation.check import NUMEXPR_INSTALLED



```python
rng = np.random.default_rng(20260928)
days = pd.date_range("2026-06-01", periods=120, freq="D")
south = 18 + 6 * np.sin(np.arange(120) / 19) + rng.normal(0, 0.8, 120)
north = south + 0.02 * np.arange(120) / 7 + rng.normal(0, 0.3, 120)
df = pd.DataFrame({"date": days, "south_c": south, "north_c": north})
df["delta_c"] = df["north_c"] - df["south_c"]
df.shape
```




    (120, 4)



## 2. The raw table

The first few rows, as pandas draws them in a notebook:


```python
df.head(6)
```




<div>
<style scoped>
    .dataframe tbody tr th:only-of-type {
        vertical-align: middle;
    }

    .dataframe tbody tr th {
        vertical-align: top;
    }

    .dataframe thead th {
        text-align: right;
    }
</style>
<table border="1" class="dataframe">
  <thead>
    <tr style="text-align: right;">
      <th></th>
      <th>date</th>
      <th>south_c</th>
      <th>north_c</th>
      <th>delta_c</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th>0</th>
      <td>2026-06-01</td>
      <td>17.612904</td>
      <td>17.884210</td>
      <td>0.271306</td>
    </tr>
    <tr>
      <th>1</th>
      <td>2026-06-02</td>
      <td>18.907721</td>
      <td>18.552038</td>
      <td>-0.355683</td>
    </tr>
    <tr>
      <th>2</th>
      <td>2026-06-03</td>
      <td>18.340157</td>
      <td>18.711992</td>
      <td>0.371835</td>
    </tr>
    <tr>
      <th>3</th>
      <td>2026-06-04</td>
      <td>19.482630</td>
      <td>19.396411</td>
      <td>-0.086219</td>
    </tr>
    <tr>
      <th>4</th>
      <td>2026-06-05</td>
      <td>19.026118</td>
      <td>19.470873</td>
      <td>0.444755</td>
    </tr>
    <tr>
      <th>5</th>
      <td>2026-06-06</td>
      <td>20.115346</td>
      <td>20.098502</td>
      <td>-0.016844</td>
    </tr>
  </tbody>
</table>
</div>



A plain-text version of one column's summary, using the `text/plain` repr of a `Series`:


```python
df["delta_c"].describe()
```




    count    120.000000
    mean       0.080525
    std        0.331904
    min       -0.730461
    25%       -0.139027
    50%        0.083719
    75%        0.300582
    max        0.846127
    Name: delta_c, dtype: float64



## 3. Timing a slow cell

The magic below measures the whole cell, not a single line.


```python
%%time
weekly = df.set_index("date").resample("W").mean(numeric_only=True)
slope = np.polyfit(np.arange(len(weekly)), weekly["delta_c"], 1)[0]
print(f"drift: {slope:.4f} degrees per week")
```

    drift: 0.0213 degrees per week
    CPU times: user 6.12 ms, sys: 1.01 ms, total: 7.13 ms
    Wall time: 6.74 ms


The estimate is close to the $0.02$ we built in, which is the sanity check we wanted.

## 4. Plots

A line plot of the weekly difference. The first figure was saved next to the notebook and is referenced by file name; the export does not embed it.


```python
weekly["delta_c"].plot(title="Weekly mean difference (north minus south)")
plt.ylabel("degrees C")
plt.show()
```


    
![png](output_7_0.png)
    


The second figure is a one-pixel placeholder that the export embedded as a data URI, so it needs no file at all:


```python
from IPython.display import Image
Image(data=open("pixel.png", "rb").read())
```




    
![png](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPYEaMFAAMOAT8PMdmpAAAAAElFTkSuQmCC)
    



## 5. Where it goes wrong

A lookup with a misspelled column name.


```python
df["north_celsius"].mean()
```


    ---------------------------------------------------------------------------

    KeyError                                  Traceback (most recent call last)

    File /opt/conda/lib/python3.12/site-packages/pandas/core/indexes/base.py:3805, in Index.get_loc(self, key)
       3804 try:
    -> 3805     return self._engine.get_loc(casted_key)
       3806 except KeyError as err:


    File index.pyx:167, in pandas._libs.index.IndexEngine.get_loc()


    KeyError: 'north_celsius'

    
    The above exception was the direct cause of the following exception:

    
    KeyError                                  Traceback (most recent call last)

    Cell In[9], line 1
    ----> 1 df["north_celsius"].mean()
          2 
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    
    File /opt/conda/lib/python3.12/site-packages/pandas/core/frame.py:4102, in DataFrame.__getitem__(self, key)
       4100 if self.columns.nlevels > 1:
       4101     return self._getitem_multilevel(key)
    -> 4102 indexer = self.columns.get_loc(key)
                       ^^^^^^^^^^^^^^^^^^^^^^^^^

    KeyError: 'north_celsius'


A slow loop that I interrupted by hand.


```python
total = 0
for i in range(10**12):
    total += math.sqrt(i)
```


    ---------------------------------------------------------------------------

    KeyboardInterrupt                         Traceback (most recent call last)

    Cell In[10], line 3
          1 total = 0
          2 for i in range(10**12):
    ----> 3     total += math.sqrt(i)
    

    KeyboardInterrupt: 


## 6. A very long output

Printing a list is a common mistake. This one is the `repr` of 2,000 characters on a single line, the way a notebook prints it:


```python
sample = [round(random.random(), 4) for _ in range(250)]
sample
```




    [0.4671, 0.7604, 0.8436, 0.6331, 0.3224, 0.6981, 0.6579, 0.8521, 0.2785, 0.4359, 0.5405, 0.8221, 0.8365, 0.2859, 0.4773, 0.3651, 0.2581, 0.7565, 0.6589, 0.2117, 0.2431, 0.1795, 0.7451, 0.6243, 0.8092, 0.8969, 0.1778, 0.5989, 0.4739, 0.2311, 0.9064, 0.9813, 0.9638, 0.2811, 0.6157, 0.6561, 0.6069, 0.6166, 0.7676, 0.3876, 0.3803, 0.2647, 0.8999, 0.3263, 0.9169, 0.5092, 0.3426, 0.8068, 0.4984, 0.2487, 0.8416, 0.1017, 0.6836, 0.1831, 0.2065, 0.1085, 0.3512, 0.8236, 0.6168, 0.5819, 0.5565, 0.2486, 0.5555, 0.5415, 0.5312, 0.4463, 0.7549, 0.5138, 0.4746, 0.7198, 0.7723, 0.3908, 0.9153, 0.9462, 0.8318, 0.5135, 0.3439, 0.8112, 0.3983, 0.3134, 0.2436, 0.2648, 0.4708, 0.7682, 0.7698, 0.3675, 0.6118, 0.9569, 0.2561, 0.3243, 0.8485, 0.8202, 0.2469, 0.2235, 0.8131, 0.8593, 0.8848, 0.3295, 0.4079, 0.5323, 0.5038, 0.5962, 0.2142, 0.9291, 0.9029, 0.6997, 0.9769, 0.4336, 0.2058, 0.2075, 0.8371, 0.2071, 0.4288, 0.5321, 0.8941, 0.5471, 0.4121, 0.6379, 0.2167, 0.9099, 0.7878, 0.2966, 0.3396, 0.3988, 0.1901, 0.6124, 0.8098, 0.2551, 0.8295, 0.7616, 0.8731, 0.2076, 0.3869, 0.9168, 0.1119, 0.5649, 0.5013, 0.8517, 0.9777, 0.5563, 0.2547, 0.1459, 0.1783, 0.7553, 0.8782, 0.7357, 0.2105, 0.5446, 0.4346, 0.1817, 0.5531, 0.7026, 0.6491, 0.2464, 0.2581, 0.7225, 0.5956, 0.7048, 0.7036, 0.4938, 0.7591, 0.7317, 0.2002, 0.9058, 0.7305, 0.7358, 0.2611, 0.8564, 0.1081, 0.4371, 0.3782, 0.9717, 0.7071, 0.9073, 0.6674, 0.2716, 0.3055, 0.5184, 0.4705, 0.1372, 0.7762, 0.1693, 0.1297, 0.4657, 0.5821, 0.9871, 0.7736, 0.1169, 0.3368, 0.4232, 0.7781, 0.4864, 0.8565, 0.9865, 0.3905, 0.4639, 0.3553, 0.1897, 0.1332, 0.9569, 0.3594, 0.6981, 0.4237, 0.4907, 0.4432, 0.7056, 0.1769, 0.5141, 0.8129, 0.3808, 0.4763, 0.5718, 0.4896, 0.1538, 0.7314, 0.6251, 0.6676, 0.1404, 0.1578, 0.1275, 0.5509, 0.3226, 0.5441, 0.7889, 0.1938, 0.4306, 0.1971, 0.3887, 0.7958, 0.4982, 0.6769, 0.3151, 0.3309, 0.5851, 0.4615, 0.2438, 0.6076, 0.1874, 0.3054, 0.3863, 0.6921, 0.7814, 0.2817, 0.4655, 0.4415, 0.7712, 0.2204, 0.1022, 0.3257, 0.2351]



## 7. Conclusion

The south sensor and the north sensor agree to within a few hundredths of a degree per week. We can say:

- the estimated drift is about $0.02\,^{\circ}\mathrm{C}$ per week;
- the noise in $\Delta T$ has a standard deviation near $0.33$, so a single reading cannot show drift;
- a table of the weekly values is in the appendix below.

| Quantity | Symbol | Value |
| --- | :---: | ---: |
| Drift rate | $\alpha$ | 0.0213 |
| Noise (sd) | $\sigma$ | 0.3319 |
| Weeks | $n$ | 18 |

<div class="alert alert-block alert-warning">
<b>Caveat:</b> synthetic data build in a drift of exactly 0.02 degrees per week, so a recovery of 0.0213 says the method works, not that real sensors drift.
</div>

## Appendix: the weekly table

The same resample, printed with `to_html(justify="left")` so the header cells carry explicit alignment. This is the output of the last cell of the notebook; the export wrote it straight into the markdown, `<style>` block and all.


```python
weekly.head(10).round(3).reset_index().to_html(justify="left", index=False)
```




<div>
<style scoped>
    .dataframe tbody tr th:only-of-type {
        vertical-align: middle;
    }

    .dataframe thead th {
        text-align: left;
    }
</style>
<table border="1" class="dataframe">
  <thead>
    <tr style="text-align: left;">
      <th align="left">week ending</th>
      <th align="right">south_c</th>
      <th align="right">north_c</th>
      <th align="right">delta_c</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th align="left">2026-06-07</th>
      <td align="right">17.591</td>
      <td align="right">17.451</td>
      <td align="right">-0.140</td>
    </tr>
    <tr>
      <th align="left">2026-06-14</th>
      <td align="right">20.207</td>
      <td align="right">20.056</td>
      <td align="right">-0.151</td>
    </tr>
    <tr>
      <th align="left">2026-06-21</th>
      <td align="right">19.287</td>
      <td align="right">19.273</td>
      <td align="right">-0.014</td>
    </tr>
    <tr>
      <th align="left">2026-06-28</th>
      <td align="right">15.464</td>
      <td align="right">15.527</td>
      <td align="right">+0.063</td>
    </tr>
    <tr>
      <th align="left">2026-07-05</th>
      <td align="right">15.300</td>
      <td align="right">15.353</td>
      <td align="right">+0.053</td>
    </tr>
    <tr>
      <th align="left">2026-07-12</th>
      <td align="right">15.559</td>
      <td align="right">15.495</td>
      <td align="right">-0.064</td>
    </tr>
    <tr>
      <th align="left">2026-07-19</th>
      <td align="right">18.396</td>
      <td align="right">18.647</td>
      <td align="right">+0.251</td>
    </tr>
    <tr>
      <th align="left">2026-07-26</th>
      <td align="right">15.990</td>
      <td align="right">16.020</td>
      <td align="right">+0.029</td>
    </tr>
    <tr>
      <th align="left">2026-08-02</th>
      <td align="right">20.019</td>
      <td align="right">20.359</td>
      <td align="right">+0.339</td>
    </tr>
    <tr>
      <th align="left">2026-08-09</th>
      <td align="right">19.617</td>
      <td align="right">19.755</td>
      <td align="right">+0.139</td>
    </tr>
  </tbody>
</table>
</div>



A last stream, written to standard error by a library the notebook imports. It is a warning, not a failure, and the notebook carried on:


```python
import legacy_plotting  # hypothetical helper module
legacy_plotting.draw(weekly)
```

    /home/analyst/notebooks/legacy_plotting.py:48: DeprecationWarning: `draw` is deprecated since 3.1 and will be removed in 4.0; use `render` instead.
      warnings.warn(
    /home/analyst/notebooks/legacy_plotting.py:61: RuntimeWarning: invalid value encountered in divide
      scale = (hi - lo) / (hi - lo).sum()
