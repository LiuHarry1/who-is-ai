# 技术房素材（93k SmarTest / T2000 memory test）
  111
## 行话
- "跑个shmoo看看margin" —— 怀疑 timing 或 level 临界的时候的口头禅
- "又bin4了" —— 测试项挂了，先看 datalog 再说
- "correlation对不上" —— 两台机台/两个site结果不一致，最头疼的活
- "pattern一直fail，先offline过一遍" —— 上机台前先离线仿真
- "这个site有点飘" —— 某个 site 结果不稳定，多半怀疑硬件
- "test time又超了" —— 量产最在意的指标，又要砍测试项了
- "先查硬件再怀疑程序" —— 老工程师的口头禅，socket/load board 背锅率最高
- "retention要跑overnight" —— memory 测试一跑一晚上，人只能第二天看结果
- "ALPG的pattern改起来头大" —— memory test 写算法 pattern 的日常
- "handler又掉料了" —— 机械问题，只能等设备的人来
- "prober又alarm了" —— CP 测试时探针台报警，产线电话就来了
- "datalog先拉下来看看" —— 出问题第一步永远是看 log
- "STDF解出来看分布" —— 分析良率用
- "redundancy修一下还能救" —— memory 有冗余修复，fail 了不一定真废

## 战例
- 有次 FT 良率突然掉，pattern 查了两天啥问题没有，最后是 socket 里一根 pogo pin 歪了，气死
- correlation 两周对不上，两边各说各话，最后发现两块 load board 版本不一样，白折腾
- retention 跑 overnight 全 fail，早上过来吓一跳，结果是温控在半夜飘了，跟程序没关系
- 有个 bin 偶发 fail，shmoo 出来 margin 特别窄，最后调了下 strobe timing 就好了，但查的过程要命
- CP 良率掉了好几个点，查了半天程序，最后是 probe card 有根针脏了，擦一下就好

## 吐槽
- 机台时间永远约不到，好不容易约到了 handler 又坏了
- 驻场客户产线一蹲就是两周，酒店-fab两点一线
- 白天开会晚上才轮到机台，debug 全靠熬夜
- 客户说"急，今天必须出结果"，然后他们的料下午才到
- 文档里写的和机台上实际行为不一样，最后还是得自己试