import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import "./App.css";

const YourComponent = () => {
  const [myID, setMyID] = useState(null);
  const [peerList, setPeerList] = useState({});
  const videoRef = useRef();
  const myRoomID = "your_room_id";
  // socketio
  const socket = io("http://127.0.0.1:5000", {
    autoConnect: true,
  });

  useEffect(() => {
    const myVideo = videoRef.current;

    const addVideoElement = (element_id, display_name) => {
      const videoGrid = document.getElementById("video_grid");
      videoGrid.appendChild(makeVideoElementCustom(element_id, display_name));
      checkVideoLayout();
    };

    const removeVideoElement = (element_id) => {
      const videoObj = getVideoObj(element_id);
      if (videoObj.srcObject) {
        videoObj.srcObject.getTracks().forEach((track) => track.stop());
      }
      videoObj.removeAttribute("srcObject");
      videoObj.removeAttribute("src");

      document.getElementById("vid_" + element_id).remove();
    };

    const startWebRTC = () => {
      for (const peerID in peerList) {
        invite(peerID);
      }
    };

    const checkVideoLayout = () => {
      // 추가적인 레이아웃 체크 로직을 작성하세요.
    };

    const closeConnection = (peer_id) => {
      if (peer_id in peerList) {
        peerList[peer_id].onicecandidate = null;
        peerList[peer_id].ontrack = null;
        peerList[peer_id].onnegotiationneeded = null;

        delete peerList[peer_id];
        setPeerList((prevPeerList) => ({ ...prevPeerList }));
      }
    };

    const getVideoObj = (element_id) => {
      return document.getElementById("vid_" + element_id);
    };

    const invite = (peerID) => {
      if (peerList[peerID]) {
        console.log(
          "[Not supposed to happen!] 이미 존재하는 연결을 시작하려고 합니다!"
        );
      } else if (peerID === myID) {
        console.log(
          "[Not supposed to happen!] 자기 자신에게 연결을 시도하고 있습니다!"
        );
      } else {
        console.log(`[${peerID}]에 대한 피어 연결을 생성 중...`);
        createPeerConnection(peerID);
        sleep(2000).then(() => {
          const localStream = myVideo.srcObject;
          localStream.getTracks().forEach((track) => {
            peerList[peerID].addTrack(track, localStream);
          });
        });
      }
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    socket.on("connect", () => {
      console.log("소켓 연결됨....");
      socket.current.emit("join-room", {
        room_id: myRoomID,
        name: "name",
      });
    });

    socket.on("user-connect", (data) => {
      console.log("사용자 연결됨 ", data);
      const peerID = data["sid"];
      const displayName = data["name"];
      setPeerList((prevPeerList) => ({ ...prevPeerList, [peerID]: undefined }));
      addVideoElement(peerID, displayName);
    });

    socket.on("user-disconnect", (data) => {
      console.log("사용자 연결 해제됨 ", data);
      const peerID = data["sid"];
      closeConnection(peerID);
      removeVideoElement(peerID);
    });

    socket.on("user-list", (data) => {
      console.log("사용자 목록 수신됨 ", data);
      setMyID(data["my_id"]);

      if ("list" in data) {
        const receivedList = data["list"];

        setPeerList((prevPeerList) => {
          const newPeerList = { ...prevPeerList };

          for (const peerID in receivedList) {
            const displayName = receivedList[peerID];
            newPeerList[peerID] = undefined;
            addVideoElement(peerID, displayName);
          }

          return newPeerList;
        });

        startWebRTC();
      }
    });

    const makeVideoElementCustom = (element_id, display_name) => {
      const vid = document.createElement("video");
      vid.id = "vid_" + element_id;
      vid.autoplay = true;
      return vid;
    };

    const createPeerConnection = async (peerID) => {
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          {
            urls: [
              "stun:stun.l.google.com:19302",
              "stun:stun1.l.google.com:19302",
              "stun:stun2.l.google.com:19302",
              "stun:stun3.l.google.com:19302",
              "stun:stun4.l.google.com:19302",
            ],
          },
        ],
      });

      peerConnection.onicecandidate = (event) => {
        handleICECandidateEvent(event, peerID);
      };
      peerConnection.ontrack = (event) => {
        handleTrackEvent(event, peerID);
      };
      peerConnection.onnegotiationneeded = () => {
        handleNegotiationNeededEvent(peerID);
      };

      // 로컬 비디오 및 오디오를 가져오기
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // 로컬 비디오와 오디오 트랙을 각각 가져와서 피어 연결에 추가
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      // 로컬 비디오를 뮤트 처리
      const localVideoObj = document.getElementById("local_vid");
      localVideoObj.srcObject = localStream;
      localVideoObj.muted = true;

      setPeerList((prevPeerList) => ({
        ...prevPeerList,
        [peerID]: peerConnection,
      }));
    };

    const handleICECandidateEvent = (event, peer_id) => {
      if (event.candidate) {
        sendViaServer({
          sender_id: myID,
          target_id: peer_id,
          type: "new-ice-candidate",
          candidate: event.candidate,
        });
      }
    };

    const handleTrackEvent = (event, peer_id) => {
      console.log(`track event received from <${peer_id}>`);

      if (event.streams && event.streams[0]) {
        getVideoObj(peer_id).srcObject = event.streams[0];
      }
    };

    const handleNegotiationNeededEvent = async (peerID) => {
      try {
        const offer = await peerList[peerID].createOffer();
        await peerList[peerID].setLocalDescription(offer);
        console.log(`[${peerID}]에게 오퍼 전송 중...`);
        sendViaServer({
          sender_id: myID,
          target_id: peerID,
          type: "offer",
          sdp: peerList[peerID].localDescription,
        });
      } catch (error) {
        log_error(error);
      }
    };

    const sendViaServer = (data) => {
      socket.emit("data", data);
    };

    const log_error = (error) => {
      console.error("[ERROR] ", error);
    };

    return () => {
      // Cleanup logic here
      socket.disconnect();
    };
  }, [socket, myID, myRoomID, peerList]);

  return (
    <div>
      <video id="local_vid" ref={videoRef} autoPlay />
      <div id="video_grid">{/* Render remote videos here */}</div>
      {/* Add other UI elements as needed */}
    </div>
  );
};

export default YourComponent;
